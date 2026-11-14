import { cryptoReady, fromBase64, generateKey, toBase64 } from '@/crypto/aead';
import { bytesToBase64 } from '@/crypto/base64';
import { BLOB_SCHEME } from '@/notes/blobs';
import { MemoryNoteStore } from '@/notes/memory-store';
import { createNote, newId, withBody } from '@/notes/model';
import { contentOfDoc, type RichNode } from '@/notes/rich-text';
import {
  buildSharedNote,
  buildShareLink,
  isShareId,
  MAX_SHARE_BYTES,
  openShare,
  openShareMeta,
  parseShareFragment,
  sealShare,
  sealShareMeta,
  ShareError,
  type SharedNote,
} from '@/share/codec';
import { fetchSharedNote, SupabaseRemote, SyncError } from '@/sync/supabase';

beforeAll(async () => {
  await cryptoReady();
});

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

const sample: SharedNote = {
  v: 1,
  title: 'Recette secrète',
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'beurre' }] }] },
  sharedAt: 1_700_000_000_000,
};

describe('copie partagée', () => {
  it('ne se lit qu’avec la clé du lien, pour ce lien', () => {
    const id = newId();
    const key = generateKey();
    const sealed = sealShare(id, sample, key);
    const visible = latin1(fromBase64(sealed));
    expect(visible).not.toContain('Recette');
    expect(visible).not.toContain('beurre');
    expect(openShare(id, sealed, key)).toEqual(sample);
    expect(() => openShare(id, sealed, generateKey())).toThrow();
    expect(() => openShare(newId(), sealed, key)).toThrow();
  });

  it('refuse une copie de forme inattendue ou trop lourde', () => {
    const id = newId();
    const key = generateKey();
    const odd = sealShare(id, { ...sample, v: 2 } as unknown as SharedNote, key);
    expect(() => openShare(id, odd, key)).toThrow();
    const heavy = { ...sample, title: 'x'.repeat(MAX_SHARE_BYTES) };
    expect(() => sealShare(id, heavy, key)).toThrow(ShareError);
  });

  it('inclut les images de la note, et refuse si l’une manque sur l’appareil', async () => {
    const store = new MemoryNoteStore();
    const pixel = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const blobId = newId();
    await store.putBlob(blobId, pixel);
    const docWith = (id: string): RichNode => ({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'rouge',
              marks: [{ type: 'textStyle', attrs: { color: 'palette:red' } }],
            },
          ],
        },
        { type: 'image', attrs: { src: `${BLOB_SCHEME}${id}` } },
      ],
    });
    const noteWith = (id: string) => ({
      ...withBody(createNote(1), contentOfDoc(docWith(id)), 2),
      title: 'Photo',
      attachments: [{ id: newId(), name: 'secret.pdf', mime: 'application/pdf', size: 3 }],
    });

    const shared = await buildSharedNote(noteWith(blobId), store, 5);
    expect(shared.title).toBe('Photo');
    expect(shared.sharedAt).toBe(5);
    expect(shared.doc.content![1].attrs!.src).toBe(
      `data:image/jpeg;base64,${bytesToBase64(pixel)}`,
    );
    // Les couleurs restent des jetons ; les fichiers joints ne sont pas partagés.
    expect(JSON.stringify(shared)).toContain('palette:red');
    expect(JSON.stringify(shared)).not.toContain('secret.pdf');

    await expect(buildSharedNote(noteWith(newId()), store, 5)).rejects.toThrow(ShareError);
  });

  it('une note en texte brut se partage aussi', async () => {
    const note = { ...createNote(1), title: 'T', body: 'ligne 1\nligne 2', plainText: 'ligne 1\nligne 2' };
    const shared = await buildSharedNote(note, new MemoryNoteStore(), 1);
    expect(shared.doc.content).toHaveLength(2);
  });
});

describe('ce que garde le propriétaire', () => {
  it('se relit avec la clé du compte seulement', () => {
    const id = newId();
    const wrapKey = generateKey();
    const meta = { noteId: newId(), key: toBase64(generateKey()), title: 'Titre' };
    const sealed = sealShareMeta(id, meta, wrapKey);
    expect(latin1(fromBase64(sealed))).not.toContain('Titre');
    expect(openShareMeta(id, sealed, wrapKey)).toEqual(meta);
    expect(openShareMeta(id, sealed, generateKey())).toBeNull();
    expect(openShareMeta(newId(), sealed, wrapKey)).toBeNull();
    expect(openShareMeta(id, 'pas-du-base64!', wrapKey)).toBeNull();
  });
});

describe('lien', () => {
  const id = '0b0e8f6e-5b7a-4c1d-9e2f-3a4b5c6d7e8f';

  it('porte la clé dans le fragment, jamais dans le chemin', () => {
    const key = generateKey();
    const link = buildShareLink('https://notes.exemple.fr/', id, key, null);
    const [address, fragment] = link.split('#');
    expect(address).toBe(`https://notes.exemple.fr/s/${id}`);
    expect(address).not.toContain(toBase64(key));
    expect(parseShareFragment(fragment)).toEqual({ key, instance: null });
    expect(parseShareFragment(`#${fragment}`)).toEqual({ key, instance: null });
    expect(buildShareLink('securenotes://', id, key, null)).toBe(
      `securenotes://s/${id}#${toBase64(key)}`,
    );
  });

  it('précise l’instance quand elle n’est pas celle par défaut', () => {
    const key = generateKey();
    const instance = { url: 'https://supabase.exemple.fr', anonKey: 'sb_publishable_x.y' };
    const link = buildShareLink('https://notes.exemple.fr', id, key, instance);
    expect(parseShareFragment(link.split('#')[1])).toEqual({ key, instance });
  });

  it('refuse un fragment incomplet, malformé, ou une instance non HTTPS', () => {
    const key = toBase64(generateKey());
    const where = (url: string) => toBase64(new TextEncoder().encode(JSON.stringify([url, 'k'])));
    expect(parseShareFragment('')).toBeNull();
    expect(parseShareFragment(key.slice(0, 20))).toBeNull();
    expect(parseShareFragment(`${key}.xx`)).toBeNull();
    expect(parseShareFragment(`${key}.${where('http://a.example')}`)).toBeNull();
    expect(parseShareFragment(`${key}.${where('javascript:alert(1)')}`)).toBeNull();
    expect(parseShareFragment(`${key}.${where('https://a.example')}.z`)).toBeNull();
    expect(isShareId(id)).toBe(true);
    expect(isShareId('../items')).toBe(false);
  });
});

describe('serveur', () => {
  const instance = { url: 'https://a.example', anonKey: 'anon' };
  type Call = { method: string; path: string; headers: Record<string, string>; body: unknown };

  function fakeFetch(answer: (call: Call) => [number, unknown]) {
    const calls: Call[] = [];
    const impl = (async (input: string, init: RequestInit) => {
      const call: Call = {
        method: init.method ?? 'GET',
        path: input.replace(instance.url, ''),
        headers: init.headers as Record<string, string>,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      };
      calls.push(call);
      const [status, body] = answer(call);
      return { status, text: async () => (body === null ? '' : JSON.stringify(body)) };
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it('lit une copie sans compte, et distingue un lien révoqué d’une panne', async () => {
    const id = newId();
    const found = fakeFetch(() => [200, 'chiffré']);
    expect(await fetchSharedNote(instance, id, found.impl)).toBe('chiffré');
    expect(found.calls[0]).toMatchObject({
      method: 'POST',
      path: '/rest/v1/rpc/get_shared_note',
      body: { share_id: id },
    });
    // Aucune session : seule la clé publique de l'instance accompagne la requête.
    expect(found.calls[0].headers.Authorization).toBeUndefined();

    expect(await fetchSharedNote(instance, id, fakeFetch(() => [200, null]).impl)).toBeNull();
    await expect(fetchSharedNote(instance, id, fakeFetch(() => [500, {}]).impl)).rejects.toThrow(
      SyncError,
    );
  });

  it('crée, liste et révoque un partage avec la session du compte', async () => {
    const rows: Record<string, unknown>[] = [];
    const { impl, calls } = fakeFetch(({ method, path, body }) => {
      if (path.startsWith('/auth')) return [200, { access_token: 'jeton', user: { id: 'moi' } }];
      if (method === 'POST') {
        rows.push({ ...(body as object), created_at: '2026-11-14T10:00:00Z' });
        return [201, null];
      }
      if (method === 'DELETE') {
        rows.length = 0;
        return [204, null];
      }
      return [200, rows];
    });
    const remote = new SupabaseRemote(instance, { email: 'e', password: 'p' }, impl);

    await remote.createShare('s1', 'chiffré', 'méta');
    expect(await remote.listShares()).toEqual([
      { id: 's1', meta: 'méta', createdAt: Date.parse('2026-11-14T10:00:00Z') },
    ]);
    await remote.deleteShare('s1');
    expect(await remote.listShares()).toEqual([]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toContain(
      'DELETE /rest/v1/shared_notes?id=eq.s1',
    );
  });
});
