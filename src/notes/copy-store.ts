import { blobIdsOf } from '@/notes/blobs';
import type { NoteStore, NoteView } from '@/notes/types';

type Source = Pick<NoteStore, 'listNotes' | 'getNote' | 'listCategories' | 'listBlobs' | 'getBlob'>;
type Target = Pick<NoteStore, 'saveNote' | 'saveCategory' | 'putBlob'>;

const VIEWS: NoteView[] = ['active', 'archived', 'trash'];

/**
 * Images et fichiers joints dont une note a besoin mais dont le contenu n'est
 * pas sur cet appareil (synchronisation pas terminée).
 */
export async function missingContent(source: Source): Promise<number> {
  const blobs = await source.listBlobs();
  return blobs.filter((blob) => blob.referenced && !blob.hasData).length;
}

export type CopyReport = { notes: number; categories: number; blobs: number };

/**
 * Recopie tout le contenu d'une base dans une autre (corbeille comprise).
 *
 * Seul le contenu passe : la cible le considère comme jamais envoyé, et rien
 * de l'état de synchronisation de la source ne la suit. Les blobs viennent en
 * premier, pour qu'une note n'existe jamais dans la cible sans ses images.
 *
 * @throws si un blob utilisé par une note manque dans la source : la copie
 *   serait incomplète.
 */
export async function copyContent(source: Source, target: Target): Promise<CopyReport> {
  const notes = [];
  for (const view of VIEWS) {
    for (const summary of await source.listNotes({ view })) {
      const note = await source.getNote(summary.id);
      if (note) notes.push(note);
    }
  }

  const needed = new Set(notes.flatMap(blobIdsOf));
  let blobs = 0;
  for (const id of needed) {
    const data = await source.getBlob(id);
    if (!data) {
      throw new Error(
        'Des images ou fichiers joints ne sont pas encore sur cet appareil : synchronisez avant de recommencer.',
      );
    }
    await target.putBlob(id, data);
    blobs += 1;
  }

  const categories = await source.listCategories();
  for (const category of categories) await target.saveCategory(category);
  for (const note of notes) await target.saveNote(note);

  return { notes: notes.length, categories: categories.length, blobs };
}
