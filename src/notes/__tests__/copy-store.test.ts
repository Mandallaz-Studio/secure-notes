import { cryptoReady } from '@/crypto/aead';
import { BLOB_SCHEME } from '@/notes/blobs';
import { copyContent, missingContent } from '@/notes/copy-store';
import { MemoryNoteStore } from '@/notes/memory-store';
import {
  createCategory,
  createNote,
  newId,
  trashed,
  withArchived,
  withAttachments,
  withBody,
  withText,
} from '@/notes/model';
import { contentOfDoc } from '@/notes/rich-text';

beforeAll(async () => {
  await cryptoReady();
});

const NOW = 1_700_000_000_000;

function noteWithImage(imageId: string) {
  return withBody(
    createNote(NOW),
    contentOfDoc({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: `${BLOB_SCHEME}${imageId}`, alt: null, title: null } }],
    }),
    NOW,
  );
}

describe('copie du contenu vers une autre base', () => {
  it('recopie notes (corbeille comprise), catégories et blobs, tous à envoyer', async () => {
    const source = new MemoryNoteStore();
    const target = new MemoryNoteStore();
    const category = createCategory('Perso', NOW);
    await source.saveCategory(category);
    const imageId = newId();
    const fileId = newId();
    await source.storeRemoteBlob(imageId, new Uint8Array([1, 2]));
    await source.storeRemoteBlob(fileId, new Uint8Array([3]));
    const notes = [
      withText(createNote(NOW, category.id), 'Active', 'texte', NOW),
      withArchived(withText(createNote(NOW), 'Archivée', '', NOW), true, NOW),
      trashed(withText(createNote(NOW), 'Jetée', '', NOW), NOW),
      withAttachments(noteWithImage(imageId), [{ id: fileId, name: 'a.txt', mime: 'text/plain', size: 1 }], NOW),
    ];
    for (const note of notes) await source.saveNote(note);
    // Côté source, tout a déjà été envoyé à l'ancien compte.
    for (const entry of await source.listPending()) await source.markPushed(entry, 1);

    const report = await copyContent(source, target);

    expect(report).toEqual({ notes: 4, categories: 1, blobs: 2 });
    for (const note of notes) expect(await target.getNote(note.id)).toEqual(note);
    expect(await target.listCategories()).toEqual([category]);
    expect(await target.getBlob(imageId)).toEqual(new Uint8Array([1, 2]));
    // Le nouveau compte n'a rien reçu : tout est à envoyer.
    expect((await target.listPending()).map((entry) => entry.id).sort()).toEqual(
      [category.id, ...notes.map((note) => note.id)].sort(),
    );
    expect((await target.listBlobs()).every((blob) => !blob.uploaded)).toBe(true);
  });

  it('refuse de copier si une image n’est pas encore sur l’appareil', async () => {
    const source = new MemoryNoteStore();
    await source.saveNote(noteWithImage(newId()));

    expect(await missingContent(source)).toBe(1);
    await expect(copyContent(source, new MemoryNoteStore())).rejects.toThrow('synchronisez');
  });
});
