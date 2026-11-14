import type { NoteStore } from '@/notes/types';
import { openShareMeta } from '@/share/codec';
import type { RemoteShare } from '@/sync/supabase';

/**
 * Révocation automatique des liens d'une note mise à la corbeille.
 *
 * Faite à chaque synchronisation plutôt qu'au moment du geste : elle aboutit
 * ainsi même si l'appareil était hors ligne, ou si la note a été mise à la
 * corbeille sur un autre appareil. Une note supprimée définitivement avant
 * que ses liens aient pu être révoqués est encore reconnue tant que sa
 * suppression n'a pas été envoyée : il faut donc passer ici avant l'envoi.
 *
 * Les liens d'une note inconnue de cet appareil ne sont pas touchés : elle
 * peut simplement ne pas être encore arrivée.
 */

export interface ShareRemote {
  listShares(): Promise<RemoteShare[]>;
  deleteShare(id: string): Promise<void>;
}

type RevokeStore = Pick<NoteStore, 'listNotes' | 'listPending'>;

/**
 * @param checked États déjà vérifiés (`<id de la note>:<mise à la corbeille>`),
 *   pour ne pas interroger le serveur quand rien n'a changé. Complété ici.
 * @returns le nombre de liens révoqués.
 */
export async function revokeTrashedShares(
  store: RevokeStore,
  remote: ShareRemote,
  wrapKey: Uint8Array,
  checked: Set<string>,
): Promise<number> {
  const gone = new Map<string, string>();
  for (const note of await store.listNotes({ view: 'trash' })) {
    gone.set(note.id, `${note.id}:${note.deletedAt}`);
  }
  for (const entry of await store.listPending()) {
    if (entry.kind === 'tombstone') gone.set(entry.id, `${entry.id}:deleted`);
  }
  const unchecked = [...gone.values()].filter((key) => !checked.has(key));
  if (unchecked.length === 0) return 0;

  let revoked = 0;
  for (const share of await remote.listShares()) {
    const meta = openShareMeta(share.id, share.meta, wrapKey);
    if (meta && gone.has(meta.noteId)) {
      await remote.deleteShare(share.id);
      revoked += 1;
    }
  }
  for (const key of unchecked) checked.add(key);
  return revoked;
}
