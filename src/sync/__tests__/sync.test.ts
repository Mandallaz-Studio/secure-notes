import { cryptoReady, fromBase64, generateKey } from '@/crypto/aead';
import { deriveVaultKeys } from '@/crypto/keys';
import { MemoryNoteStore } from '@/notes/memory-store';
import {
  createCategory,
  createNote,
  renamed,
  trashed,
  withCategory,
  withText,
} from '@/notes/model';
import type { Note, NoteStore } from '@/notes/types';
import { openItem, sealDeletion, sealItem } from '@/sync/codec';
import { synchronize, type RemoteRow, type SyncRemote } from '@/sync/engine';
import {
  credentialsFor,
  normalizeInstanceUrl,
  SupabaseRemote,
  SyncError,
} from '@/sync/supabase';

beforeAll(async () => {
  await cryptoReady();
});

/** Serveur simulé : mêmes règles que la table `items` (numéros croissants, version attendue). */
class FakeServer {
  rows = new Map<string, RemoteRow>();
  private seq = 0;

  remote(instanceId = 'https://a.example'): SyncRemote {
    return {
      instanceId,
      pull: async (afterSeq, limit) =>
        [...this.rows.values()]
          .filter((row) => row.seq > afterSeq)
          .sort((a, b) => a.seq - b.seq)
          .slice(0, limit)
          .map((row) => ({ ...row })),
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
    };
  }
}

let server: FakeServer;
let wrapKey: Uint8Array;
let phone: NoteStore;
let tablet: NoteStore;
let clock: number;
const tick = () => (clock += 1000);

const sync = (store: NoteStore, remote = server.remote()) =>
  synchronize(store, remote, wrapKey, tick);

async function write(store: NoteStore, title: string, text = ''): Promise<Note> {
  const note = withText(createNote(tick()), title, text, clock);
  await store.saveNote(note);
  return note;
}

async function edit(store: NoteStore, id: string, text: string): Promise<void> {
  const note = await store.getNote(id);
  await store.saveNote(withText(note!, note!.title, text, tick()));
}

const titles = async (store: NoteStore, view: 'active' | 'trash' = 'active') =>
  (await store.listNotes({ view })).map((note) => note.title).sort();

beforeEach(() => {
  server = new FakeServer();
  wrapKey = generateKey();
  phone = new MemoryNoteStore();
  tablet = new MemoryNoteStore();
  clock = 1_700_000_000_000;
});

describe('chiffrement des éléments', () => {
  it('fait un aller-retour sans rien laisser en clair', async () => {
    const note = await write(phone, 'Titre secret', 'Contenu secret');
    const sealed = sealItem({ kind: 'note', note }, wrapKey);

    expect(openItem(note.id, sealed, wrapKey)).toEqual({ kind: 'note', note });
    const visible = String.fromCharCode(...fromBase64(sealed.ciphertext));
    expect(visible).not.toContain('secret');
    expect(visible).not.toContain('note');
  });

  it('refuse un blob présenté sous un autre identifiant ou une autre clé', async () => {
    const note = await write(phone, 'A');
    const other = await write(phone, 'B');
    const sealed = sealItem({ kind: 'note', note }, wrapKey);

    expect(() => openItem(other.id, sealed, wrapKey)).toThrow();
    expect(() => openItem(note.id, sealed, generateKey())).toThrow();
  });

  it('chiffre différemment à chaque envoi', async () => {
    const note = await write(phone, 'A');
    const first = sealItem({ kind: 'note', note }, wrapKey);
    const second = sealItem({ kind: 'note', note }, wrapKey);

    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.wrappedKey).not.toBe(second.wrappedKey);
  });
});

describe('synchronisation entre deux appareils', () => {
  it('transmet notes et catégories, puis ne renvoie plus rien', async () => {
    const category = createCategory('Travail', tick());
    await phone.saveCategory(category);
    const note = await write(phone, 'Courses', 'Pain');
    await phone.saveNote(withCategory(note, category.id, tick()));

    expect(await sync(phone)).toMatchObject({ pushed: 2, pulled: 0 });
    expect(await sync(tablet)).toMatchObject({ pushed: 0, pulled: 2 });

    expect(await tablet.getNote(note.id)).toEqual(await phone.getNote(note.id));
    expect(await tablet.listCategories()).toEqual([category]);
    expect(await sync(phone)).toMatchObject({ pushed: 0, pulled: 0 });
    expect(await sync(tablet)).toMatchObject({ pushed: 0, pulled: 0 });
  });

  it('ne montre au serveur ni titre ni contenu', async () => {
    await write(phone, 'Titre secret', 'Contenu secret');
    await sync(phone);

    expect(JSON.stringify([...server.rows.values()])).not.toMatch(/secret/i);
  });

  it('propage une modification, la corbeille et le renommage d’une catégorie', async () => {
    const category = createCategory('Perso', tick());
    await phone.saveCategory(category);
    const note = await write(phone, 'Note', 'v1');
    await sync(phone);
    await sync(tablet);

    await edit(tablet, note.id, 'v2');
    await tablet.saveCategory(renamed(category, 'Personnel', tick()));
    await sync(tablet);
    await sync(phone);
    expect((await phone.getNote(note.id))?.body).toBe('v2');
    expect((await phone.listCategories())[0].name).toBe('Personnel');

    await phone.saveNote(trashed((await phone.getNote(note.id))!, tick()));
    await sync(phone);
    await sync(tablet);
    expect(await titles(tablet)).toEqual([]);
    expect(await titles(tablet, 'trash')).toEqual(['Note']);
  });

  it('propage une suppression définitive', async () => {
    const note = await write(phone, 'Éphémère');
    const category = createCategory('Vide', tick());
    await phone.saveCategory(category);
    await sync(phone);
    await sync(tablet);

    await tablet.deleteNote(note.id);
    await tablet.deleteCategory(category.id, tick());
    await sync(tablet);
    await sync(phone);

    expect(await phone.getNote(note.id)).toBeNull();
    expect(await phone.listCategories()).toEqual([]);
    // Pour le serveur, une suppression est un blob chiffré comme un autre.
    expect(openItem(note.id, server.rows.get(note.id)!, wrapKey)).toEqual({
      kind: 'deleted',
      id: note.id,
    });
    expect(await tablet.listPending()).toEqual([]);
  });

  it('n’envoie rien pour une note supprimée avant son premier envoi', async () => {
    const note = await write(phone, 'Brouillon');
    await phone.deleteNote(note.id);

    expect(await sync(phone)).toMatchObject({ pushed: 0 });
    expect(server.rows.size).toBe(0);
  });

  it('garde les deux versions d’une note modifiée des deux côtés', async () => {
    const note = await write(phone, 'Liste', 'origine');
    await sync(phone);
    await sync(tablet);

    await edit(phone, note.id, 'version téléphone');
    await edit(tablet, note.id, 'version tablette'); // la plus récente
    await sync(phone);
    expect(await sync(tablet)).toMatchObject({ conflicts: 1 });
    await sync(phone);

    for (const store of [phone, tablet]) {
      expect((await store.getNote(note.id))?.body).toBe('version tablette');
      expect(await titles(store)).toEqual(['Liste', 'Liste (copie de conflit)']);
    }
    const copy = (await phone.listNotes({ view: 'active' })).find((n) => n.id !== note.id)!;
    expect((await phone.getNote(copy.id))?.body).toBe('version téléphone');
    expect(await sync(tablet)).toMatchObject({ pushed: 0, pulled: 0 });
  });

  it('garde en copie la version du serveur quand la version locale est plus récente', async () => {
    const note = await write(phone, 'Liste', 'origine');
    await sync(phone);
    await sync(tablet);

    await edit(tablet, note.id, 'version tablette');
    await edit(phone, note.id, 'version téléphone'); // la plus récente
    await sync(tablet);
    expect(await sync(phone)).toMatchObject({ conflicts: 1 });
    await sync(tablet);

    for (const store of [phone, tablet]) {
      expect((await store.getNote(note.id))?.body).toBe('version téléphone');
      expect(await titles(store)).toEqual(['Liste', 'Liste (copie de conflit)']);
    }
  });

  it('ne crée pas de copie quand les deux côtés ont fait la même modification', async () => {
    const note = await write(phone, 'Liste', 'origine');
    await sync(phone);
    await sync(tablet);

    await edit(phone, note.id, 'pareil');
    await edit(tablet, note.id, 'pareil');
    await sync(phone);
    expect(await sync(tablet)).toMatchObject({ conflicts: 0 });

    expect(await titles(tablet)).toEqual(['Liste']);
    expect(await tablet.listPending()).toEqual([]);
  });

  it('fait gagner une modification sur une suppression définitive, dans les deux sens', async () => {
    const kept = await write(phone, 'Modifiée ici');
    const revived = await write(phone, 'Modifiée là-bas');
    await sync(phone);
    await sync(tablet);

    await edit(phone, kept.id, 'encore là');
    await tablet.deleteNote(kept.id);
    await phone.deleteNote(revived.id);
    await edit(tablet, revived.id, 'encore là');
    await sync(tablet);
    await sync(phone);
    await sync(tablet);

    for (const store of [phone, tablet]) {
      expect((await store.getNote(kept.id))?.body).toBe('encore là');
      expect((await store.getNote(revived.id))?.body).toBe('encore là');
      expect(await store.listPending()).toEqual([]);
    }
  });

  it('ignore une suppression fabriquée par le serveur', async () => {
    const victim = await write(phone, 'Visée');
    const other = await write(phone, 'Autre');
    await sync(phone);
    await sync(tablet);
    await tablet.deleteNote(other.id);
    await sync(tablet);

    // Le serveur vide la ligne, puis rejoue la suppression d'une autre note.
    const seq = Math.max(...[...server.rows.values()].map((row) => row.seq));
    server.rows.set(victim.id, { id: victim.id, seq: seq + 1, ciphertext: '', wrappedKey: '' });
    expect(await sync(phone)).toMatchObject({ unreadable: 1 });
    server.rows.set(victim.id, { ...server.rows.get(other.id)!, id: victim.id, seq: seq + 2 });
    expect(await sync(phone)).toMatchObject({ unreadable: 1 });
    server.rows.set(victim.id, { id: victim.id, seq: seq + 3, ...sealDeletion(victim.id, generateKey()) });
    expect(await sync(phone)).toMatchObject({ unreadable: 1 });

    expect((await phone.getNote(victim.id))?.title).toBe('Visée');
    expect(await phone.getNote(other.id)).toBeNull();
  });

  it('ignore une ligne illisible sans bloquer le reste', async () => {
    const good = await write(phone, 'Lisible');
    const bad = await write(phone, 'Altérée');
    await sync(phone);
    server.rows.get(bad.id)!.ciphertext = server.rows.get(good.id)!.ciphertext;

    expect(await sync(tablet)).toMatchObject({ pulled: 1, unreadable: 1 });
    expect(await titles(tablet)).toEqual(['Lisible']);
  });

  it('reprend au bon endroit au-delà d’une page de résultats', async () => {
    for (let index = 0; index < 450; index += 1) await write(phone, `Note ${index}`);
    await sync(phone);

    expect(await sync(tablet)).toMatchObject({ pulled: 450 });
    expect(await titles(tablet)).toHaveLength(450);
  });

  it('renvoie tout vers une nouvelle instance', async () => {
    await write(phone, 'A');
    await sync(phone);
    const other = new FakeServer();

    expect(
      await synchronize(phone, other.remote('https://b.example'), wrapKey, tick),
    ).toMatchObject({ pushed: 1 });
    expect(other.rows.size).toBe(1);
  });

  it('renvoie une note modifiée pendant son envoi', async () => {
    const note = await write(phone, 'Note', 'v1');
    const remote = server.remote();
    const insert = remote.insert;
    remote.insert = async (row) => {
      await edit(phone, note.id, 'v2');
      return insert(row);
    };

    await sync(phone, remote);
    expect(await phone.listPending()).toHaveLength(1);
    await sync(phone);
    await sync(tablet);
    expect((await tablet.getNote(note.id))?.body).toBe('v2');
  });
});

describe('compte de synchronisation', () => {
  const keys = () => deriveVaultKeys(new Uint8Array(32).fill(7));

  it('normalise l’adresse de l’instance', () => {
    expect(normalizeInstanceUrl(' HTTPS://Projet.Supabase.co/ ')).toBe(
      'https://projet.supabase.co',
    );
    expect(normalizeInstanceUrl('https://exemple.fr/supabase//')).toBe(
      'https://exemple.fr/supabase',
    );
    expect(normalizeInstanceUrl('http://10.0.2.2:54321', true)).toBe('http://10.0.2.2:54321');
    expect(() => normalizeInstanceUrl('http://exemple.fr')).toThrow(SyncError);
    expect(() => normalizeInstanceUrl('exemple.fr')).toThrow(SyncError);
    expect(() => normalizeInstanceUrl('https://exemple.fr/?x=1')).toThrow(SyncError);
  });

  it('dérive un mot de passe propre à chaque instance, sans exposer le secret', () => {
    const a = credentialsFor(keys(), 'https://a.example');
    const b = credentialsFor(keys(), 'https://b.example');

    expect(a.email).toBe(`${keys().accountId}@securenotes.invalid`);
    expect(a).toEqual(credentialsFor(keys(), 'https://a.example'));
    expect(a.password).not.toBe(b.password);
    expect(a.password).not.toBe(keys().authSecret);
    expect(a.password).toHaveLength(43);
  });

  /** Fabrique un `fetch` qui répond selon une table et note les requêtes. */
  function fakeFetch(answer: (method: string, path: string, body: unknown) => [number, unknown]) {
    const calls: { method: string; path: string; headers: Record<string, string> }[] = [];
    const impl = (async (input: string, init: RequestInit) => {
      const path = input.replace('https://a.example', '');
      const method = init.method ?? 'GET';
      calls.push({ method, path, headers: init.headers as Record<string, string> });
      const [status, body] = answer(method, path, init.body ? JSON.parse(String(init.body)) : null);
      return { status, text: async () => (body === null ? '' : JSON.stringify(body)) };
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  const remoteWith = (impl: typeof fetch) =>
    new SupabaseRemote(
      { url: 'https://a.example', anonKey: 'anon' },
      credentialsFor(keys(), 'https://a.example'),
      impl,
    );

  it('crée le compte au premier usage puis interroge la table', async () => {
    const { impl, calls } = fakeFetch((method, path) => {
      if (path.startsWith('/auth/v1/token')) return [400, { error_code: 'invalid_credentials' }];
      if (path === '/auth/v1/signup') return [200, { access_token: 'jeton', expires_in: 3600 }];
      if (method === 'GET') {
        return [200, [{ id: 'x', seq: 5, ciphertext: 'c', wrapped_key: 'k' }]];
      }
      if (method === 'POST') return [201, [{ seq: 6 }]];
      return [200, []];
    });
    const remote = remoteWith(impl);

    expect(await remote.pull(4, 200)).toEqual([
      { id: 'x', seq: 5, ciphertext: 'c', wrappedKey: 'k' },
    ]);
    expect(await remote.insert({ id: 'y', ciphertext: 'c', wrappedKey: 'k' })).toBe(6);
    expect(
      await remote.update({ id: 'y', ciphertext: 'c2', wrappedKey: 'k2' }, 6),
    ).toBeNull();

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /auth/v1/token?grant_type=password',
      'POST /auth/v1/signup',
      'GET /rest/v1/items?select=id,seq,ciphertext,wrapped_key&seq=gt.4&order=seq.asc&limit=200',
      'POST /rest/v1/items?select=seq',
      'PATCH /rest/v1/items?id=eq.y&seq=eq.6&select=seq',
    ]);
    expect(calls[2].headers).toMatchObject({ apikey: 'anon', Authorization: 'Bearer jeton' });
  });

  it('signale un identifiant déjà pris comme un conflit', async () => {
    const { impl } = fakeFetch((method, path) =>
      path.startsWith('/auth') ? [200, { access_token: 'jeton' }] : [409, { code: '23505' }],
    );

    expect(await remoteWith(impl).insert({ id: 'y', ciphertext: 'c', wrappedKey: 'k' })).toBeNull();
  });

  it('rouvre la session quand le jeton est refusé', async () => {
    let logins = 0;
    const { impl } = fakeFetch((method, path) => {
      if (path.startsWith('/auth')) return [200, { access_token: `jeton-${(logins += 1)}` }];
      return logins < 2 ? [401, { message: 'JWT expired' }] : [200, []];
    });

    expect(await remoteWith(impl).pull(0, 10)).toEqual([]);
    expect(logins).toBe(2);
  });

  it('explique les échecs courants', async () => {
    const failing = (answer: Parameters<typeof fakeFetch>[0]) =>
      remoteWith(fakeFetch(answer).impl).pull(0, 10);

    await expect(failing(() => [401, { message: 'Invalid API key' }])).rejects.toThrow(
      /Vérifiez l'adresse et la clé/,
    );
    await expect(
      failing((method, path) =>
        path.startsWith('/auth/v1/token') ? [400, {}] : [200, { id: 'utilisateur' }],
      ),
    ).rejects.toThrow(/Confirm email/);
    await expect(
      failing((method, path) =>
        path.startsWith('/auth/v1/token')
          ? [400, {}]
          : [422, { error_code: 'user_already_exists' }],
      ),
    ).rejects.toThrow(/autre adresse/);
    await expect(
      failing((method, path) =>
        path.startsWith('/auth') ? [200, { access_token: 'j' }] : [404, { code: 'PGRST205' }],
      ),
    ).rejects.toThrow(/migrations/);
    await expect(
      remoteWith((async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch).pull(0, 10),
    ).rejects.toThrow(/injoignable/);
  });
});
