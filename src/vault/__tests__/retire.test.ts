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

const OLD_USER = 'utilisateur-ancien';
const NEW_USER = 'utilisateur-nouveau';

/**
 * Instance simulée : propriétaire de chaque partage, accords de transfert et
 * identifiants révoqués (qui ne peuvent plus resservir).
 */
function server(quotaShares: number) {
  const owners = new Map<string, { user: string; meta: string }>();
  const revoked = new Set<string>();
  const handovers = new Set<string>();
  const sharesOf = (user: string) =>
    [...owners.entries()].filter(([, share]) => share.user === user).map(([id]) => id);
  return {
    owners,
    revoked,
    handovers,
    sharesOf,
    remove(id: string) {
      owners.delete(id);
      revoked.add(id);
    },
    transfer(id: string, from: string, to: string, meta: string): boolean {
      if (!handovers.has(`${from}>${to}`)) throw new Error('handover_not_accepted');
      if (owners.get(id)?.user === to) return true;
      if (owners.get(id)?.user !== from) return false;
      if (sharesOf(to).length >= quotaShares) throw new QuotaExceededError('quota');
      owners.set(id, { user: to, meta });
      return true;
    },
  };
}

/** Ancien compte simulé : partages, fichiers, et journal des appels. */
function oldAccount(instance: ReturnType<typeof server>, oldWrapKey: Uint8Array, shareCount: number) {
  const log: string[] = [];
  const shares: RemoteShare[] = Array.from({ length: shareCount }, (_, index) => {
    const id = newId();
    const meta: ShareMeta = { noteId: `note-${index}`, key: `clé-${index}`, title: `Note ${index}` };
    const sealed = sealShareMeta(id, meta, oldWrapKey);
    instance.owners.set(id, { user: OLD_USER, meta: sealed });
    return { id, meta: sealed, createdAt: index };
  });
  let attachments = ['f1', 'f2'];
  let failClose = false;
  let failTransferAt = -1;
  let transfers = 0;
  const remote: NonNullable<RetireDeps['oldRemote']> = {
    accountUserId: async () => OLD_USER,
    listShares: async () => {
      log.push('listShares');
      return shares.filter((share) => instance.owners.get(share.id)?.user === OLD_USER);
    },
    transferShare: async (id, successor, meta) => {
      transfers += 1;
      if (transfers === failTransferAt) throw new Error('réseau');
      log.push(`transfer ${id}`);
      return instance.transfer(id, OLD_USER, successor, meta);
    },
    deleteShare: async (id) => {
      log.push(`unshare ${id}`);
      if (instance.owners.get(id)?.user === OLD_USER) instance.remove(id);
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
      for (const id of instance.sharesOf(OLD_USER)) instance.remove(id);
    },
  };
  return {
    remote,
    log,
    shares,
    failNextClose: (value: boolean) => (failClose = value),
    failTransfer: (index: number) => {
      transfers = 0;
      failTransferAt = index;
    },
  };
}

function newAccount(instance: ReturnType<typeof server>) {
  const remote: NonNullable<RetireDeps['newRemote']> = {
    accountUserId: async () => NEW_USER,
    acceptSharesFrom: async (predecessor) => {
      instance.handovers.add(`${predecessor}>${NEW_USER}`);
    },
  };
  return { remote, shares: () => instance.sharesOf(NEW_USER) };
}

function setup(shareCount: number, options: { synced?: boolean; quotaShares?: number } = {}) {
  const instance = server(options.quotaShares ?? Infinity);
  const oldWrapKey = generateKey();
  const newWrapKey = generateKey();
  const old = oldAccount(instance, oldWrapKey, shareCount);
  const next = newAccount(instance);
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
  return { deps, instance, old, next, store, newWrapKey, deleted: () => deletedDatabase };
}

describe('retrait de l’ancien coffre', () => {
  it('passe les liens au nouveau compte sous le même identifiant, puis ferme l’ancien', async () => {
    const { deps, instance, old, next, store, newWrapKey, deleted } = setup(2);

    const report = await retireVault(deps);

    expect(report).toEqual({ sharesMoved: 2, sharesRevoked: 0 });
    expect(deleted()).toBe(1);
    // Transfert en une étape : le lien n'est jamais supprimé, donc jamais libre.
    expect(old.log).toEqual([
      'listShares',
      `transfer ${old.shares[0].id}`,
      `transfer ${old.shares[1].id}`,
      'listAttachmentIds',
      'delete f1',
      'delete f2',
      'close',
    ]);
    expect(next.shares()).toEqual(old.shares.map((share) => share.id));
    expect(instance.revoked.size).toBe(0);
    // La note et la clé du lien restent lisibles par le nouveau coffre seulement.
    const moved = instance.owners.get(old.shares[1].id);
    expect(openShareMeta(old.shares[1].id, moved?.meta ?? '', newWrapKey)).toEqual({
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
    expect(next.shares()).toHaveLength(2);

    old.failNextClose(false);
    old.log.length = 0;
    const report = await retireVault(deps);

    // Liens déjà transférés : ils ne sont ni relus ni retransférés.
    expect(report.sharesMoved).toBe(0);
    expect(old.log).toEqual(['listAttachmentIds', 'close']);
    expect(next.shares()).toHaveLength(2);
  });

  it('reprend un transfert interrompu', async () => {
    const { deps, old, next, store } = setup(2);
    old.failTransfer(2);

    await expect(retireVault(deps)).rejects.toThrow('réseau');
    expect(next.shares()).toHaveLength(1);
    expect(old.log).not.toContain('close');
    expect(JSON.parse((await store.getSyncValue(PENDING_SHARES)) ?? '[]')).toHaveLength(1);

    old.log.length = 0;
    const report = await retireVault(deps);

    expect(report.sharesMoved).toBe(1);
    expect(old.log).toEqual([
      `transfer ${old.shares[1].id}`,
      'listAttachmentIds',
      'delete f1',
      'delete f2',
      'close',
    ]);
    expect(next.shares()).toEqual(old.shares.map((share) => share.id));
  });

  it('compte comme révoqué un lien que l’ancien compte n’a plus', async () => {
    const { deps, instance, old, next } = setup(2);
    const listed = await old.remote.listShares();
    deps.oldRemote = { ...old.remote, listShares: async () => listed };
    instance.remove(old.shares[0].id);

    expect(await retireVault(deps)).toEqual({ sharesMoved: 1, sharesRevoked: 1 });
    expect(next.shares()).toEqual([old.shares[1].id]);
  });

  it('révoque les liens si le nouveau coffre n’est pas synchronisé sur la même instance', async () => {
    const { deps, instance, old, next } = setup(3, { synced: false });

    const report = await retireVault(deps);

    expect(report).toEqual({ sharesMoved: 0, sharesRevoked: 3 });
    expect(old.log.some((line) => line.startsWith('transfer'))).toBe(false);
    expect(old.log).toContain('close');
    expect(next.shares()).toEqual([]);
    // Fermé, l'ancien compte a perdu ses liens, et leurs identifiants sont grillés.
    expect(instance.revoked.size).toBe(3);
  });

  it('révoque les liens qui ne tiennent plus dans le quota du nouveau compte', async () => {
    const { deps, instance, old, next } = setup(3, { quotaShares: 1 });

    expect(await retireVault(deps)).toEqual({ sharesMoved: 1, sharesRevoked: 2 });
    expect(next.shares()).toHaveLength(1);
    expect(instance.revoked).toEqual(new Set([old.shares[1].id, old.shares[2].id]));
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
