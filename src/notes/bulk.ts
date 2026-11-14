import type { Note, NoteStore } from '@/notes/types';

/**
 * Actions sur plusieurs notes à la fois (sélection dans la liste).
 * Chaque note est relue avant d'être modifiée : la synchronisation a pu la
 * changer depuis l'affichage de la liste. Une note disparue entre-temps est
 * ignorée.
 */

type BulkStore = Pick<NoteStore, 'getNote' | 'saveNote' | 'deleteNote'>;

/** Applique `change` à chaque note ; renvoie le nombre de notes modifiées. */
export async function updateNotes(
  store: BulkStore,
  ids: readonly string[],
  change: (note: Note, now: number) => Note,
  now: number,
): Promise<number> {
  let changed = 0;
  for (const id of ids) {
    const note = await store.getNote(id);
    if (!note) continue;
    await store.saveNote(change(note, now));
    changed += 1;
  }
  return changed;
}

/** Supprime définitivement les notes. */
export async function deleteNotes(store: BulkStore, ids: readonly string[]): Promise<void> {
  for (const id of ids) await store.deleteNote(id);
}
