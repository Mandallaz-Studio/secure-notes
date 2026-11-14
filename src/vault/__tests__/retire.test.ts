import { cryptoReady, generateKey } from '@/crypto/aead';
import { MemoryNoteStore } from '@/notes/memory-store';
import { newId } from '@/notes/model';
import { openShareMeta, sealShareMeta, type ShareMeta } from '@/share/codec';
import { QuotaExceededError } from '@/sync/blobs';
import type { RemoteShare } from '@/sync/supabase';
import { parseRetiring, PENDING_SHARES, retireVault, type RetireDeps } from '@/vault/retire';

beforeAll(async () => {
  await cryptoReady();
});

/** Ancien compte simulé : partages, fichiers, et journal des appels. */
function oldAccount(oldWrapKey: Uint8Array, shareCount: number) {
  const log: string[] = [];
  const shares: RemoteShare[] = Array.from({ length: shareCount }, (_, index) => {
    const id = newId();
    const meta: ShareMeta = { noteId: `note-${index}`, key: `clé-${index}`, title: `Note ${index}` };
    return { id, meta: sealShareMeta(id, meta, oldWrapKey), createdAt: index };
  });
  let attachments = ['f1', 'f2'];
  let closed = false;
  let failClose = false;
  const remote: NonNullable<RetireDeps['oldRemote']> = {
    listShares: async () => {
      log.push('listShares');
      return closed ? [] : shares;
    },
    getShareCiphertext: async (id) => {
      log.push(`ciphertext ${id}`);
      return `copie-${id}`;
    },
    listAttachmentIds: async () => {
      log.push('listAttachmentIds');
      return attachments;
    },
    deleteAttachment: async (id) => {
      log.push(`delete ${id}`);
      attachments = attachments.filter((other) => other !== id);
    },
    closeAccount: async () => {
      log.push('close');
      if (failClose) throw new Error('réseau');
      closed = true;
    },
  };
  return { remote, log, shares, failNextClose: (value: boolean) => (failClose = value) };
}

function newAccount(quotaShares = Infinity) {
  const created: { id: string; ciphertext: string; meta: string }[] = [];
  const remote: NonNullable<RetireDeps['newRemote']> = {
    createShare: async (id, ciphertext, meta) => {
      if (created.length >= quotaShares) throw new QuotaExceededError('quota');
      created.push({ id, ciphertext, meta });
    },
  };
  return { remote, created };
}

function setup(shareCount: number, options: { synced?: boolean; quotaShares?: number } = {}) {
  const oldWrapKey = generateKey();
  const newWrapKey = generateKey();
  const old = oldAccount(oldWrapKey, shareCount);
  const next = newAccount(options.quotaShares);
  const store = new MemoryNoteStore();
  let deletedDatabase = 0;
  const deps: RetireDeps = {
    deleteOldDatabase: async () => {
      deletedDatabase += 1;
    },
    oldRemote: old.remote,
    oldWrapKey,
    newRemote: options.synced === false ? null : next.remote,
    newWrapKey,
    store,
  };
  return { deps, old, next, store, newWrapKey, deleted: () => deletedDatabase };
}

describe('retrait de l’ancien coffre', () => {
  it('vide et ferme l’ancien compte, puis lui reprend ses liens sous le même identifiant', async () => {
    const { deps, old, next, store, newWrapKey, deleted } = setup(2);

    const report = await retireVault(deps);

    expect(report).toEqual({ sharesMoved: 2, sharesRevoked: 0 });
    expect(deleted()).toBe(1);
    expect(old.log).toEqual([
      'listShares',
      `ciphertext ${old.shares[0].id}`,
      `ciphertext ${old.shares[1].id}`,
      'listAttachmentIds',
      'delete f1',
      'delete f2',
      'close',
    ]);
    expect(next.created.map((share) => share.id)).toEqual(old.shares.map((share) => share.id));
    expect(next.created[0].ciphertext).toBe(`copie-${old.shares[0].id}`);
    // La note et la clé du lien restent lisibles par le nouveau coffre seulement.
    expect(openShareMeta(next.created[1].id, next.created[1].meta, newWrapKey)).toEqual({
      noteId: 'note-1',
      key: 'clé-1',
      title: 'Note 1',
    });
    expect(await store.getSyncValue(PENDING_SHARES)).toBe('[]');
  });

  it('reprend après une interruption sans perdre les liens mis de côté', async () => {
    const { deps, old, next } = setup(2);
    old.failNextClose(true);

    await expect(retireVault(deps)).rejects.toThrow('réseau');
    expect(next.created).toEqual([]);

    old.failNextClose(false);
    old.log.length = 0;
    const report = await retireVault(deps);

    expect(report.sharesMoved).toBe(2);
    // La liste des partages n'est pas relue : l'ancien compte a pu les perdre.
    expect(old.log).not.toContain('listShares');
    expect(next.created).toHaveLength(2);
  });

  it('révoque les liens si le nouveau coffre n’est pas synchronisé sur la même instance', async () => {
    const { deps, old, next } = setup(3, { synced: false });

    const report = await retireVault(deps);

    expect(report).toEqual({ sharesMoved: 0, sharesRevoked: 3 });
    expect(old.log.some((line) => line.startsWith('ciphertext'))).toBe(false);
    expect(old.log).toContain('close');
    expect(next.created).toEqual([]);
  });

  it('révoque les liens qui ne tiennent plus dans le quota du nouveau compte', async () => {
    const { deps, next } = setup(3, { quotaShares: 1 });

    expect(await retireVault(deps)).toEqual({ sharesMoved: 1, sharesRevoked: 2 });
    expect(next.created).toHaveLength(1);
  });

  it('se limite à la base locale si l’ancien coffre n’était pas synchronisé', async () => {
    const { deps, old, deleted } = setup(1);

    expect(await retireVault({ ...deps, oldRemote: null })).toEqual({
      sharesMoved: 0,
      sharesRevoked: 0,
    });
    expect(deleted()).toBe(1);
    expect(old.log).toEqual([]);
  });
});

describe('enregistrement du retrait', () => {
  const valid = {
    accountId: 'a'.repeat(32),
    successorId: 'b'.repeat(32),
    masterKey: '0f'.repeat(32),
    instance: { url: 'https://a.example', anonKey: 'anon' },
  };

  it('relit un enregistrement valide', () => {
    expect(parseRetiring(JSON.stringify(valid))).toEqual(valid);
    expect(parseRetiring(JSON.stringify({ ...valid, instance: null }))?.instance).toBeNull();
  });

  it('écarte un enregistrement illisible ou incomplet', () => {
    expect(parseRetiring('{')).toBeNull();
    expect(parseRetiring(JSON.stringify({ ...valid, masterKey: 'court' }))).toBeNull();
    expect(parseRetiring(JSON.stringify({ ...valid, instance: { url: 1 } }))).toBeNull();
    expect(parseRetiring(JSON.stringify({ ...valid, successorId: undefined }))).toBeNull();
  });
});
