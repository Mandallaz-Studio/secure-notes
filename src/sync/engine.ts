import { newId } from '@/notes/model';
import type { Category, Note, NoteStore, RemoteChange, SyncEntry, SyncItem } from '@/notes/types';
import { idOf, openItem, sealDeletion, sealItem, type SealedItem } from '@/sync/codec';

/**
 * Moteur de synchronisation.
 *
 * Le serveur numérote chaque écriture (`seq`). Un appareil :
 *  1. télécharge ce qui a changé après le dernier numéro qu'il a vu ;
 *  2. envoie ses éléments modifiés, en précisant le numéro de la version qu'ils
 *     remplacent — le serveur refuse si quelqu'un d'autre a écrit entre-temps,
 *     et l'on recommence au point 1.
 *
 * Conflit (un élément modifié des deux côtés) : la modification la plus récente
 * l'emporte, l'autre version d'une note est conservée dans une copie. Une
 * modification l'emporte toujours sur une suppression définitive.
 *
 * Rien de ce que dit le serveur n'est cru sans preuve : une ligne n'est
 * appliquée (suppression comprise) que si elle se déchiffre avec la clé du compte.
 *
 * Le chiffrement prouve qu'une version vient du compte, pas qu'elle est la
 * dernière : un serveur malveillant pourrait renvoyer, sous un nouveau numéro,
 * un ancien chiffré (retour à une version antérieure, note supprimée qui
 * réapparaît). Chaque version porte donc une date de modification qui ne
 * recule jamais (`touched`), et l'appareil retient la plus récente échangée
 * pour chaque élément, même supprimé (`getVersionFloor`). Une version qui
 * n'est pas plus récente, ou une suppression d'une version plus ancienne que
 * celle de l'appareil, est écartée et la version de l'appareil renvoyée.
 * Reste possible : que le serveur retienne des versions (non détectable sans
 * manifeste signé de l'ensemble du compte).
 */

export type RemoteRow = SealedItem & { id: string; seq: number };

export interface SyncRemote {
  /** Identifie l'instance : s'il change, tout l'état local de synchro est remis à zéro. */
  readonly instanceId: string;
  /** Lignes de numéro supérieur à `afterSeq`, par numéro croissant. */
  pull(afterSeq: number, limit: number): Promise<RemoteRow[]>;
  /** @returns le numéro attribué, ou `null` si l'identifiant existe déjà. */
  insert(row: Omit<RemoteRow, 'seq'>): Promise<number | null>;
  /** @returns le numéro attribué, ou `null` si la version du serveur n'est plus `baseSeq`. */
  update(row: Omit<RemoteRow, 'seq'>, baseSeq: number): Promise<number | null>;
}

export type SyncResult = {
  /** Changements du serveur appliqués localement. */
  pulled: number;
  /** Éléments envoyés. */
  pushed: number;
  /** Notes modifiées des deux côtés (une copie a été créée). */
  conflicts: number;
  /** Lignes du serveur illisibles (altérées ou d'une version plus récente), ignorées. */
  unreadable: number;
  /**
   * Versions périmées renvoyées par le serveur (ancienne version d'un élément,
   * élément supprimé depuis), écartées : la version de l'appareil est renvoyée.
   */
  stale: number;
};

const PAGE_SIZE = 200;
const MAX_ROUNDS = 3;
const CURSOR = 'cursor';
const INSTANCE = 'instance';

const CONFLICT_SUFFIX = ' (copie de conflit)';

function sameNote(a: Note, b: Note): boolean {
  return (
    a.title === b.title &&
    a.body === b.body &&
    a.bodyFormat === b.bodyFormat &&
    a.categoryId === b.categoryId &&
    a.archived === b.archived &&
    a.pinned === b.pinned &&
    a.hidden === b.hidden &&
    a.deletedAt === b.deletedAt &&
    JSON.stringify(a.attachments) === JSON.stringify(b.attachments)
  );
}

function sameCategory(a: Category, b: Category): boolean {
  return a.name === b.name;
}

function updatedAtOf(item: SyncItem): number {
  return item.kind === 'note' ? item.note.updatedAt : item.category.updatedAt;
}

/** L'élément local contient-il déjà exactement cette version ? */
function holds(local: SyncEntry | null, incoming: SyncItem): boolean {
  if (local?.kind === 'note' && incoming.kind === 'note') {
    return local.note.updatedAt === incoming.note.updatedAt && sameNote(local.note, incoming.note);
  }
  if (local?.kind === 'category' && incoming.kind === 'category') {
    return (
      local.category.updatedAt === incoming.category.updatedAt &&
      sameCategory(local.category, incoming.category)
    );
  }
  return false;
}

/**
 * La ligne reçue est-elle plus ancienne que ce que l'appareil connaît ?
 * Référence : la plus récente version échangée avec le serveur, et la version
 * locale si elle n'a pas de modification en attente.
 */
async function isStale(store: NoteStore, local: SyncEntry | null, change: RemoteChange) {
  // Une suppression en attente est toujours « à envoyer » (`dirty`).
  const clean = local && !local.dirty ? updatedAtOf(local) : null;
  const floor = await store.getVersionFloor(change.kind === 'deleted' ? change.id : idOf(change));
  const known = Math.max(clean ?? -Infinity, floor ?? -Infinity);
  if (change.kind === 'deleted') {
    // Une suppression vise la dernière version connue de son auteur : si cet
    // appareil, sans rien en attente, en a une plus récente, elle est périmée.
    return clean !== null && change.lastUpdatedAt !== undefined && change.lastUpdatedAt < clean;
  }
  const version = updatedAtOf(change);
  return version < known || (version === known && !holds(local, change));
}

function conflictCopy(note: Note, now: number): Note {
  return {
    ...note,
    id: newId(),
    title: `${note.title.trim() || 'Sans titre'}${CONFLICT_SUFFIX}`,
    updatedAt: now,
  };
}

export async function synchronize(
  store: NoteStore,
  remote: SyncRemote,
  wrapKey: Uint8Array,
  now: () => number = Date.now,
): Promise<SyncResult> {
  const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, unreadable: 0, stale: 0 };

  if ((await store.getSyncValue(INSTANCE)) !== remote.instanceId) {
    await store.resetSync();
    await store.setSyncValue(INSTANCE, remote.instanceId);
  }

  const applyRow = async (row: RemoteRow): Promise<void> => {
    const local = await store.getSyncEntry(row.id);
    // Déjà connu : c'est l'écho de notre propre envoi.
    if (local && local.serverSeq !== null && local.serverSeq >= row.seq) return;

    let change: RemoteChange;
    try {
      change = openItem(row.id, row, wrapKey);
    } catch {
      result.unreadable += 1;
      return;
    }
    if (await isStale(store, local, change)) {
      await store.requeue(row.id, row.seq);
      result.stale += 1;
      return;
    }
    const incoming = change.kind === 'deleted' ? null : change;

    // Une suppression locale en attente cède devant toute version du serveur.
    if (!local || !local.dirty || local.kind === 'tombstone') {
      if (incoming) {
        await store.applyRemote(incoming, row.seq);
        result.pulled += 1;
      } else if (local) {
        await store.applyRemote({ kind: 'deleted', id: row.id }, row.seq);
        if (local.kind !== 'tombstone') result.pulled += 1;
      }
      return;
    }

    // À partir d'ici, l'élément a été modifié localement depuis son dernier envoi.
    if (!incoming) {
      // Supprimé ailleurs, modifié ici : il sera renvoyé.
      await store.setServerSeq(row.id, row.seq);
      return;
    }
    if (local.kind === 'note' && incoming.kind === 'note') {
      if (sameNote(local.note, incoming.note)) {
        await store.applyRemote(incoming, row.seq);
        return;
      }
      result.conflicts += 1;
      if (local.note.updatedAt > incoming.note.updatedAt) {
        await store.saveNote(conflictCopy(incoming.note, now()));
        await store.setServerSeq(row.id, row.seq);
      } else {
        await store.saveNote(conflictCopy(local.note, now()));
        await store.applyRemote(incoming, row.seq);
      }
      result.pulled += 1;
      return;
    }
    // Catégories : la plus récente l'emporte, sans copie.
    if (
      local.kind === 'category' &&
      incoming.kind === 'category' &&
      local.category.updatedAt > incoming.category.updatedAt
    ) {
      await store.setServerSeq(row.id, row.seq);
      return;
    }
    await store.applyRemote(incoming, row.seq);
    result.pulled += 1;
  };

  const pull = async (): Promise<void> => {
    let cursor = Number((await store.getSyncValue(CURSOR)) ?? 0);
    for (;;) {
      const rows = await remote.pull(cursor, PAGE_SIZE);
      for (const row of rows) {
        await applyRow(row);
        cursor = row.seq;
      }
      if (rows.length > 0) await store.setSyncValue(CURSOR, String(cursor));
      if (rows.length < PAGE_SIZE) return;
    }
  };

  const send = async (entry: SyncEntry): Promise<number | null> => {
    if (entry.kind === 'tombstone') {
      const last = await store.getVersionFloor(entry.id);
      return remote.update({ id: entry.id, ...sealDeletion(entry.id, wrapKey, last) }, entry.serverSeq);
    }
    const sealed = sealItem(entry, wrapKey);
    return entry.serverSeq === null
      ? remote.insert({ id: entry.id, ...sealed })
      : remote.update({ id: entry.id, ...sealed }, entry.serverSeq);
  };

  /** @returns `true` si le serveur a refusé un envoi (version dépassée). */
  const push = async (): Promise<boolean> => {
    let refused = false;
    for (const entry of await store.listPending()) {
      const seq = await send(entry);
      if (seq === null) {
        refused = true;
      } else {
        await store.markPushed(entry, seq);
        result.pushed += 1;
      }
    }
    return refused;
  };

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    await pull();
    if (!(await push())) break;
  }
  return result;
}
