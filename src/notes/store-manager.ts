import type { VaultKeys } from '@/crypto/keys';
import { openNoteStore, wipeNoteStore } from '@/notes/open-store';
import type { NoteStore } from '@/notes/types';

/**
 * Une seule base ouverte à la fois, et des opérations strictement
 * séquentielles : une base n'est jamais supprimée ni rouverte avant que la
 * fermeture précédente soit terminée.
 */

let current: { accountId: string; store: NoteStore } | null = null;
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.catch(() => {});
  return result;
}

async function closeCurrent(): Promise<void> {
  const open = current;
  current = null;
  await open?.store.close().catch(() => {});
}

/** Ouvre la base du compte (ou renvoie celle déjà ouverte). */
export function acquireNoteStore(keys: VaultKeys): Promise<NoteStore> {
  return enqueue(async () => {
    if (current?.accountId !== keys.accountId) {
      await closeCurrent();
      current = { accountId: keys.accountId, store: await openNoteStore(keys) };
    }
    return current.store;
  });
}

/** Ferme la base ouverte (verrouillage du coffre). */
export function releaseNoteStore(): Promise<void> {
  return enqueue(closeCurrent);
}

/** Ferme la base puis efface les notes du compte de cet appareil. */
export function destroyNoteStore(accountId: string): Promise<void> {
  return enqueue(async () => {
    await closeCurrent();
    await wipeNoteStore(accountId);
  });
}
