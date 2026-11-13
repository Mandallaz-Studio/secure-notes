import { cryptoReady, fromBase64, generateKey } from '@/crypto/aead';
import { base64ToBytes, bytesToBase64 } from '@/crypto/base64';
import {
  CHUNK_BYTES,
  chunkCountOf,
  newFileKey,
  openChunk,
  sealChunk,
  unwrapFileKey,
  wrapFileKey,
} from '@/crypto/chunks';
import {
  BLOB_SCHEME,
  blobIdsOf,
  formatBytes,
  newImageCache,
  toEditorImages,
  toStoredImages,
} from '@/notes/blobs';
import { MemoryNoteStore } from '@/notes/memory-store';
import { createNote, isBlank, newId, withAttachments, withBody } from '@/notes/model';
import { contentOfDoc, type RichNode } from '@/notes/rich-text';
import type { Note, NoteStore } from '@/notes/types';
import {
  ORPHAN_GRACE_MS,
  QuotaExceededError,
  synchronizeBlobs,
  type BlobRemote,
  type RemoteAttachment,
} from '@/sync/blobs';
import { openItem, sealItem } from '@/sync/codec';
import { synchronize, type RemoteRow, type SyncRemote } from '@/sync/engine';

beforeAll(async () => {
  await cryptoReady();
});

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

/** Octets pseudo-aléatoires reproductibles. */
function bytesOf(length: number, seed = 1): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    bytes[i] = state & 255;
  }
  return bytes;
}

/** Serveur simulé : mêmes règles que les tables `items`, `attachments` et `attachment_chunks`. */
class FakeServer {
  rows = new Map<string, RemoteRow>();
  attachments = new Map<string, RemoteAttachment & { chunks: Map<number, string> }>();
  quotaBytes = 50 * 1024 * 1024;
  private seq = 0;

  get usedBytes(): number {
    let total = 0;
    for (const attachment of this.attachments.values()) {
      for (const chunk of attachment.chunks.values()) total += Math.floor((chunk.length * 3) / 4);
    }
    return total;
  }

  remote(): SyncRemote & BlobRemote {
    return {
      instanceId: 'https://a.example',
      pull: async (afterSeq, limit) =>
        [...this.rows.values()]
          .filter((row) => row.seq > afterSeq)
          .sort((a, b) => a.seq - b.seq)
          .slice(0, limit),
      insert: async (row) => {
        if (this.rows.has(row.id)) return null;
        this.rows.set(row.id, { ...row, seq: (this.seq += 1) });
        return this.seq;
      },
      update: async (row, baseSeq) => {
        if (this.rows.get(row.id)?.seq !== baseSeq) return null;
        this.rows.set(row.id, { ...row, seq: (this.seq += 1) });
        return this.seq;
      },
      listAttachmentIds: async () => [...this.attachments.keys()],
      getAttachment: async (id) => {
        const found = this.attachments.get(id);
        return found ? { wrappedKey: found.wrappedKey, chunkCount: found.chunkCount } : null;
      },
      createAttachment: async (id, attachment) => {
        if (this.attachments.has(id)) return false;
        this.attachments.set(id, { ...attachment, chunks: new Map() });
        return true;
      },
      putChunk: async (id, index, data) => {
        const attachment = this.attachments.get(id);
        if (!attachment) throw new Error('fichier inconnu');
        if (attachment.chunks.has(index)) return;
        if (this.usedBytes + Math.floor((data.length * 3) / 4) > this.quotaBytes) {
          throw new QuotaExceededError();
        }
        attachment.chunks.set(index, data);
      },
      getChunk: async (id, index) => this.attachments.get(id)?.chunks.get(index) ?? null,
      deleteAttachment: async (id) => {
        this.attachments.delete(id);
      },
      getUsage: async () => ({ usedBytes: this.usedBytes, quotaBytes: this.quotaBytes }),
    };
  }
}

let server: FakeServer;
let wrapKey: Uint8Array;
let phone: NoteStore;
let tablet: NoteStore;
let clock: number;

const syncAll = async (store: NoteStore) => {
  const remote = server.remote();
  await synchronize(store, remote, wrapKey, () => clock);
  return synchronizeBlobs(store, remote, wrapKey, () => clock);
};

/** Note avec un fichier joint de `size` octets, enregistrée dans `store`. */
async function attach(store: NoteStore, size: number, seed = 1): Promise<{ note: Note; id: string }> {
  const id = newId();
  await store.putBlob(id, bytesOf(size, seed));
  const base = createNote((clock += 1000));
  const note = withAttachments(
    { ...base, title: 'Avec fichier' },
    [{ id, name: 'rapport.pdf', mime: 'application/pdf', size }],
    clock,
  );
  await store.saveNote(note);
  return { note, id };
}

beforeEach(() => {
  server = new FakeServer();
  wrapKey = generateKey();
  phone = new MemoryNoteStore();
  tablet = new MemoryNoteStore();
  clock = 1_700_000_000_000;
});

describe('base64 standard', () => {
  it('fait un aller-retour pour toutes les longueurs', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 1000, 70000]) {
      const bytes = bytesOf(length, length + 1);
      const text = bytesToBase64(bytes);
      expect(text.length % 4).toBe(0);
      expect(base64ToBytes(text)).toEqual(bytes);
    }
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe('aGk=');
    expect(() => base64ToBytes('a_b-')).toThrow();
  });
});

describe('chiffrement par blocs', () => {
  it('découpe en blocs de 256 Kio', () => {
    expect(chunkCountOf(0)).toBe(1);
    expect(chunkCountOf(CHUNK_BYTES)).toBe(1);
    expect(chunkCountOf(CHUNK_BYTES + 1)).toBe(2);
  });

  it('refuse un bloc déplacé, tronqué, ou venu d’un autre fichier', () => {
    const id = newId();
    const data = bytesOf(CHUNK_BYTES * 2 + 10);
    const key = newFileKey();
    const first = sealChunk(id, data, 0, key);
    const last = sealChunk(id, data, 2, key);
    expect(openChunk(id, first, 0, 3, key)).toEqual(data.subarray(0, CHUNK_BYTES));
    expect(openChunk(id, last, 2, 3, key)).toEqual(data.subarray(CHUNK_BYTES * 2));
    expect(() => openChunk(id, first, 1, 3, key)).toThrow();
    expect(() => openChunk(id, first, 0, 1, key)).toThrow();
    expect(() => openChunk(newId(), first, 0, 3, key)).toThrow();
    expect(() => openChunk(id, first, 0, 3, newFileKey())).toThrow();
  });

  it('lie la clé du fichier à son identifiant et au compte', () => {
    const id = newId();
    const key = newFileKey();
    const wrapped = wrapFileKey(id, key, wrapKey);
    expect(unwrapFileKey(id, wrapped, wrapKey)).toEqual(key);
    expect(() => unwrapFileKey(newId(), wrapped, wrapKey)).toThrow();
    expect(() => unwrapFileKey(id, wrapped, generateKey())).toThrow();
  });
});

describe('images du texte', () => {
  const pixel = bytesOf(300, 7);
  pixel.set([0x89, 0x50, 0x4e, 0x47]);
  const uri = `data:image/png;base64,${bytesToBase64(pixel)}`;
  const docWith = (src: string): RichNode => ({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'avant' }] },
      { type: 'image', attrs: { src, alt: null, title: null } },
    ],
  });

  it('sort une image du document à l’enregistrement et la remet à l’affichage', async () => {
    const cache = newImageCache();
    const stored = await toStoredImages(docWith(uri), phone, cache);
    const src = String(stored.content![1].attrs!.src);
    expect(src.startsWith(BLOB_SCHEME)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('base64');
    const id = src.slice(BLOB_SCHEME.length);
    expect(await phone.getBlob(id)).toEqual(pixel);

    // Deuxième lecture de l'éditeur : pas de second blob.
    expect(await toStoredImages(docWith(uri), phone, cache)).toEqual(stored);
    expect((await phone.listBlobs()).length).toBe(1);

    // À la réouverture, sans mémoire de la session précédente.
    expect(await toEditorImages(stored, phone, newImageCache())).toEqual(docWith(uri));
  });

  it('garde la référence d’une image pas encore téléchargée', async () => {
    const id = newId();
    const stored = docWith(`${BLOB_SCHEME}${id}`);
    const cache = newImageCache();
    const shown = await toEditorImages(stored, phone, cache);
    expect(String(shown.content![1].attrs!.src)).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(await toStoredImages(shown, phone, cache)).toEqual(stored);
    expect(await phone.getBlob(id)).toBeNull();
  });

  it('recrée le blob d’une image rétablie après sa suppression', async () => {
    const cache = newImageCache();
    const stored = await toStoredImages(docWith(uri), phone, cache);
    const id = String(stored.content![1].attrs!.src).slice(BLOB_SCHEME.length);
    await phone.deleteBlob(id);
    expect(await toStoredImages(docWith(uri), phone, cache)).toEqual(stored);
    expect(await phone.getBlob(id)).toEqual(pixel);
  });

  it('retire une image distante', async () => {
    const remote = docWith('https://example.com/pixel.png');
    expect(JSON.stringify(await toEditorImages(remote, phone, newImageCache()))).not.toContain(
      'example.com',
    );
    expect(JSON.stringify(await toStoredImages(remote, phone, newImageCache()))).not.toContain(
      'example.com',
    );
  });

  it('recense les blobs d’une note', async () => {
    const stored = await toStoredImages(docWith(uri), phone, newImageCache());
    const fileId = newId();
    const note = withAttachments(
      withBody(createNote(clock), contentOfDoc(stored), clock),
      [{ id: fileId, name: 'a.txt', mime: 'text/plain', size: 3 }],
      clock,
    );
    expect(blobIdsOf(note).sort()).toEqual(
      [String(stored.content![1].attrs!.src).slice(BLOB_SCHEME.length), fileId].sort(),
    );
  });
});

describe('fichiers joints', () => {
  it('une note qui ne porte qu’un fichier n’est pas vide', () => {
    const note = createNote(clock);
    expect(isBlank(note)).toBe(true);
    expect(
      isBlank(withAttachments(note, [{ id: newId(), name: 'a', mime: 'b', size: 1 }], clock)),
    ).toBe(false);
  });

  it('voyagent chiffrés avec la note, et une ancienne note n’en a pas', async () => {
    const { note } = await attach(phone, 10);
    const sealed = sealItem({ kind: 'note', note }, wrapKey);
    expect(latin1(fromBase64(sealed.ciphertext))).not.toContain('rapport');
    expect(openItem(note.id, sealed, wrapKey)).toEqual({ kind: 'note', note });
    expect(formatBytes(340 * 1024)).toBe('340 Ko');
    expect(formatBytes(2.4 * 1024 * 1024)).toBe('2,4 Mo');
  });
});

describe('synchronisation des blobs', () => {
  it('envoie un fichier de plusieurs blocs et le restitue à l’identique ailleurs', async () => {
    const size = CHUNK_BYTES * 2 + 123;
    const { id } = await attach(phone, size);
    expect((await syncAll(phone)).uploaded).toBe(1);
    expect(server.attachments.get(id)!.chunks.size).toBe(3);

    const result = await syncAll(tablet);
    expect(result.downloaded).toBe(1);
    expect(await tablet.getBlob(id)).toEqual(bytesOf(size));
    expect(result.usage!.usedBytes).toBeGreaterThan(size);

    // Rien à refaire ensuite.
    expect(await syncAll(phone)).toMatchObject({ uploaded: 0, downloaded: 0, removed: 0 });
    expect(await syncAll(tablet)).toMatchObject({ uploaded: 0, downloaded: 0, removed: 0 });
  });

  it('ne laisse rien en clair sur le serveur', async () => {
    const id = newId();
    await phone.putBlob(id, new TextEncoder().encode('contenu très secret '.repeat(50)));
    const note = withAttachments(
      { ...createNote(clock), title: 't' },
      [{ id, name: 'secret.txt', mime: 'text/plain', size: 1000 }],
      clock,
    );
    await phone.saveNote(note);
    await syncAll(phone);
    const stored = server.attachments.get(id)!;
    const visible = latin1(fromBase64(stored.chunks.get(0)!));
    expect(visible).not.toContain('secret');
  });

  it('le serveur refuse un envoi au-delà du quota, sans rien garder de partiel', async () => {
    server.quotaBytes = CHUNK_BYTES + 1000;
    const small = await attach(phone, 1000, 2);
    const big = await attach(phone, CHUNK_BYTES * 2, 3);
    const result = await syncAll(phone);
    expect(result).toMatchObject({ uploaded: 1, overQuota: 1 });
    expect(server.attachments.has(small.id)).toBe(true);
    expect(server.attachments.has(big.id)).toBe(false);
    expect(server.usedBytes).toBeLessThanOrEqual(server.quotaBytes);
    // Le fichier reste sur l'appareil et repart quand le quota est relevé.
    expect(await phone.getBlob(big.id)).toEqual(bytesOf(CHUNK_BYTES * 2, 3));
    server.quotaBytes = 50 * 1024 * 1024;
    expect((await syncAll(phone)).uploaded).toBe(1);
    expect(server.attachments.get(big.id)!.chunks.size).toBe(2);
  });

  it('reprend un envoi interrompu avec la clé déjà déposée', async () => {
    const size = CHUNK_BYTES * 3;
    const { id } = await attach(phone, size);
    const remote = server.remote();
    let calls = 0;
    const flaky: SyncRemote & BlobRemote = {
      ...remote,
      putChunk: async (blobId, index, data) => {
        if ((calls += 1) === 3) throw new Error('coupure');
        await remote.putChunk(blobId, index, data);
      },
    };
    await synchronize(phone, flaky, wrapKey);
    await expect(synchronizeBlobs(phone, flaky, wrapKey)).rejects.toThrow('coupure');
    expect(server.attachments.get(id)!.chunks.size).toBe(2);

    await syncAll(phone);
    await syncAll(tablet);
    expect(await tablet.getBlob(id)).toEqual(bytesOf(size));
  });

  it('ignore un fichier altéré ou incomplet sur le serveur', async () => {
    const { id } = await attach(phone, CHUNK_BYTES + 5);
    await syncAll(phone);
    const stored = server.attachments.get(id)!;
    const second = stored.chunks.get(1)!;

    stored.chunks.delete(1);
    expect(await syncAll(tablet)).toMatchObject({ downloaded: 0, unreadable: 0 });

    stored.chunks.set(1, stored.chunks.get(0)!);
    expect(await syncAll(tablet)).toMatchObject({ downloaded: 0, unreadable: 1 });
    expect(await tablet.getBlob(id)).toBeNull();

    stored.chunks.set(1, second);
    expect((await syncAll(tablet)).downloaded).toBe(1);
  });

  it('supprime partout un fichier retiré de sa note, après un délai', async () => {
    const { note, id } = await attach(phone, 5000);
    await syncAll(phone);
    await syncAll(tablet);

    await phone.saveNote(withAttachments(note, [], (clock += 1000)));
    expect((await syncAll(phone)).removed).toBe(0);
    clock += ORPHAN_GRACE_MS + 1;
    // Date.now() date la création du blob : on avance aussi l'horloge du test.
    const real = Date.now;
    Date.now = () => real() + ORPHAN_GRACE_MS + 1;
    try {
      const remote = server.remote();
      await synchronize(phone, remote, wrapKey);
      expect((await synchronizeBlobs(phone, remote, wrapKey)).removed).toBe(1);
      expect(await phone.getBlob(id)).toBeNull();
      expect(server.attachments.has(id)).toBe(false);
      expect(server.usedBytes).toBe(0);

      const other = server.remote();
      await synchronize(tablet, other, wrapKey);
      expect((await synchronizeBlobs(tablet, other, wrapKey)).removed).toBe(1);
      expect(await tablet.getBlob(id)).toBeNull();
    } finally {
      Date.now = real;
    }
  });

  it('garde le fichier d’une note à la corbeille, et le supprime avec elle', async () => {
    const { note, id } = await attach(phone, 5000);
    await syncAll(phone);
    await phone.saveNote({ ...note, deletedAt: clock, updatedAt: (clock += 1000) });
    const later = () => Date.now() + ORPHAN_GRACE_MS + 1;
    const remote = server.remote();
    await synchronize(phone, remote, wrapKey);
    expect((await synchronizeBlobs(phone, remote, wrapKey, later)).removed).toBe(0);

    await phone.emptyTrash();
    await synchronize(phone, remote, wrapKey);
    expect((await synchronizeBlobs(phone, remote, wrapKey, later)).removed).toBe(1);
    expect(server.attachments.has(id)).toBe(false);
  });

  it('renvoie un fichier encore utilisé ici mais disparu du serveur', async () => {
    const { id } = await attach(phone, 5000);
    await syncAll(phone);
    server.attachments.delete(id);
    expect((await syncAll(phone)).uploaded).toBe(1);
    expect(server.attachments.has(id)).toBe(true);
  });

  it('ne touche pas aux fichiers du serveur qu’il ne connaît pas', async () => {
    const { id } = await attach(phone, 5000);
    await synchronizeBlobs(phone, server.remote(), wrapKey);
    // La tablette ne connaît ni la note ni le fichier.
    await tablet.saveNote({ ...createNote(clock), title: 'autre' });
    const later = () => Date.now() + ORPHAN_GRACE_MS + 1;
    await synchronizeBlobs(tablet, server.remote(), wrapKey, later);
    expect(server.attachments.has(id)).toBe(true);
  });

  it('renvoie tout après un changement d’instance', async () => {
    const { id } = await attach(phone, 5000);
    await syncAll(phone);
    await phone.resetSync();
    server = new FakeServer();
    expect((await syncAll(phone)).uploaded).toBe(1);
    expect(server.attachments.has(id)).toBe(true);
  });
});
