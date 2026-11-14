import type { VaultKeys } from '@/crypto/keys';
import { copyContent, type CopyReport } from '@/notes/copy-store';
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

/**
 * Crée la base d'un autre coffre et y recopie tout le contenu de la base
 * ouverte. La base ouverte reste celle du coffre actuel.
 * @throws si aucune base n'est ouverte, ou si la copie serait incomplète.
 */
export function cloneNoteStore(next: VaultKeys): Promise<CopyReport> {
  return enqueue(async () => {
    const source = current;
    if (!source || source.accountId === next.accountId) {
      throw new Error("La base du coffre actuel n'est pas ouverte.");
    }
    // Reste d'une tentative interrompue : on repart d'une base vide.
    await wipeNoteStore(next.accountId);
    const target = await openNoteStore(next);
    let complete = false;
    try {
      const report = await copyContent(source.store, target);
      complete = true;
      return report;
    } finally {
      await target.close().catch(() => {});
      // Une copie partielle ne doit pas pouvoir servir.
      if (!complete) await wipeNoteStore(next.accountId);
    }
  });
}

/** Efface la base d'un compte ; ne ferme la base ouverte que si c'est la sienne. */
export function discardNoteStore(accountId: string): Promise<void> {
  return enqueue(async () => {
    if (current?.accountId === accountId) await closeCurrent();
    await wipeNoteStore(accountId);
  });
}

/** Ferme la base puis efface les notes du compte de cet appareil. */
export function destroyNoteStore(accountId: string): Promise<void> {
  return enqueue(async () => {
    await closeCurrent();
    await wipeNoteStore(accountId);
  });
}
