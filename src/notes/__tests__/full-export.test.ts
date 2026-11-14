import { strFromU8, unzipSync } from 'fflate';

import { cryptoReady } from '@/crypto/aead';
import { BLOB_SCHEME } from '@/notes/blobs';
import { buildFullExport, EXPORT_FORMAT, fullExportFileName } from '@/notes/full-export';
import { MemoryNoteStore } from '@/notes/memory-store';
import {
  createCategory,
  createNote,
  newId,
  trashed,
  withArchived,
  withAttachments,
  withBody,
  withHidden,
  withText,
} from '@/notes/model';
import { contentOfDoc, type RichNode } from '@/notes/rich-text';

beforeAll(async () => {
  await cryptoReady();
});

const NOW = Date.UTC(2026, 10, 14, 12);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function docWithImage(text: string, id: string): RichNode {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text }] },
      { type: 'image', attrs: { src: `${BLOB_SCHEME}${id}`, alt: null, title: null } },
    ],
  };
}

async function exportOf(store: MemoryNoteStore) {
  const result = await buildFullExport(store, NOW);
  const files = unzipSync(result.zip);
  const text = (path: string) => strFromU8(files[path]);
  return { result, files, text, paths: Object.keys(files).sort() };
}

describe('export complet', () => {
  it('range les notes par état et par catégorie, et garde tout dans le JSON', async () => {
    const store = new MemoryNoteStore();
    const work = createCategory('Travail', NOW);
    await store.saveCategory(work);
    await store.saveNote(withText(createNote(NOW, work.id), 'Réunion', 'Ordre du jour', NOW));
    await store.saveNote(
      withArchived(withText(createNote(NOW), 'Ancienne', 'Archivée', NOW), true, NOW),
    );
    await store.saveNote(trashed(withText(createNote(NOW), 'Jetée', 'À la corbeille', NOW), NOW));

    const { result, text, paths } = await exportOf(store);

    expect(result).toMatchObject({ notes: 3, files: 0, missing: 0 });
    expect(paths).toEqual([
      'LISEZMOI.txt',
      'archives/Sans catégorie/Ancienne.md',
      'corbeille/Sans catégorie/Jetée.md',
      'notes/Travail/Réunion.md',
      'secure-notes.json',
    ]);
    expect(text('notes/Travail/Réunion.md')).toBe('# Réunion\n\nOrdre du jour\n');

    const manifest = JSON.parse(text('secure-notes.json'));
    expect(manifest).toMatchObject({ format: EXPORT_FORMAT, version: 1 });
    expect(manifest.categories).toEqual([work]);
    expect(manifest.notes.map((note: { title: string }) => note.title).sort()).toEqual([
      'Ancienne',
      'Jetée',
      'Réunion',
    ]);
    expect(manifest.notes.find((note: { title: string }) => note.title === 'Jetée').deletedAt).toBe(
      NOW,
    );
  });

  it('écrit images et fichiers joints à part et les relie depuis le Markdown', async () => {
    const store = new MemoryNoteStore();
    const imageId = newId();
    const fileId = newId();
    await store.putBlob(imageId, PNG);
    await store.putBlob(fileId, new Uint8Array([7, 7, 7]));
    let note = withBody(createNote(NOW), contentOfDoc(docWithImage('Voir :', imageId)), NOW);
    note = withAttachments(
      note,
      [{ id: fileId, name: 'devis final.pdf', mime: 'application/pdf', size: 3 }],
      NOW,
    );
    await store.saveNote({ ...note, title: 'Avec fichiers' });

    const { result, files, text } = await exportOf(store);

    expect(result).toMatchObject({ notes: 1, files: 2, missing: 0 });
    expect(files[`fichiers/${imageId}.png`]).toEqual(PNG);
    expect(files[`fichiers/${fileId}/devis final.pdf`]).toEqual(new Uint8Array([7, 7, 7]));
    const markdown = text('notes/Sans catégorie/Avec fichiers.md');
    expect(markdown).toContain(`![](../../fichiers/${imageId}.png)`);
    expect(markdown).toContain(`- [devis final.pdf](../../fichiers/${fileId}/devis%20final.pdf)`);
  });

  it('signale les contenus absents de l’appareil sans échouer', async () => {
    const store = new MemoryNoteStore();
    const imageId = newId();
    await store.saveNote({
      ...withBody(createNote(NOW), contentOfDoc(docWithImage('Image :', imageId)), NOW),
      title: 'Incomplète',
    });

    const { result, paths, text } = await exportOf(store);

    expect(result.missing).toBe(1);
    expect(paths.some((path) => path.startsWith('fichiers/'))).toBe(false);
    expect(text('notes/Sans catégorie/Incomplète.md')).not.toContain(BLOB_SCHEME);
  });

  it('numérote les notes de même titre au lieu de les écraser', async () => {
    const store = new MemoryNoteStore();
    for (const text of ['un', 'deux', 'trois']) {
      await store.saveNote(withText(createNote(NOW), 'Idée', text, NOW));
    }

    const { paths } = await exportOf(store);

    expect(paths.filter((path) => path.startsWith('notes/'))).toEqual([
      'notes/Sans catégorie/Idée (2).md',
      'notes/Sans catégorie/Idée (3).md',
      'notes/Sans catégorie/Idée.md',
    ]);
  });

  it('range à part les notes du dossier privé, liens d’images compris', async () => {
    const store = new MemoryNoteStore();
    const imageId = newId();
    await store.putBlob(imageId, PNG);
    const note = withHidden(
      withBody(withText(createNote(1), 'Secret', '', 1), contentOfDoc(docWithImage('x', imageId)), 1),
      true,
      1,
    );
    await store.saveNote(note);

    const { paths, text } = await exportOf(store);

    const file = 'dossier privé/notes/Sans catégorie/Secret.md';
    expect(paths).toContain(file);
    expect(text(file)).toContain(`](../../../fichiers/${imageId}.png)`);
    expect(JSON.parse(text('secure-notes.json')).notes[0].hidden).toBe(true);
  });

  it('nomme l’archive avec la date', () => {
    expect(fullExportFileName(NOW)).toBe('secure-notes-2026-11-14.zip');
  });
});
