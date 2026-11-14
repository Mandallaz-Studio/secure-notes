import { cryptoReady } from '@/crypto/aead';
import { deleteNotes, updateNotes } from '@/notes/bulk';
import { MemoryNoteStore } from '@/notes/memory-store';
import { createNote, newId, trashed, withArchived, withCategory, withTitle } from '@/notes/model';

beforeAll(async () => {
  await cryptoReady();
});

async function seed(store: MemoryNoteStore, ...titles: string[]) {
  const notes = titles.map((title, index) => withTitle(createNote(index + 1), title, index + 1));
  for (const note of notes) await store.saveNote(note);
  return notes.map((note) => note.id);
}

const titles = async (store: MemoryNoteStore, view: 'active' | 'archived' | 'trash') =>
  (await store.listNotes({ view })).map((note) => note.title).sort();

describe('actions sur plusieurs notes', () => {
  it('archive, catégorise et met à la corbeille les notes choisies seulement', async () => {
    const store = new MemoryNoteStore();
    const [a, b] = await seed(store, 'A', 'B', 'C');
    const work = newId();

    expect(await updateNotes(store, [a, b], (n, now) => withCategory(n, work, now), 10)).toBe(2);
    expect((await store.listNotes({ view: 'active', categoryId: work })).length).toBe(2);

    await updateNotes(store, [a], (n, now) => withArchived(n, true, now), 11);
    expect(await titles(store, 'archived')).toEqual(['A']);

    await updateNotes(store, [b], trashed, 12);
    expect(await titles(store, 'active')).toEqual(['C']);
    expect(await titles(store, 'trash')).toEqual(['B']);
  });

  it('ignore une note disparue entre-temps et supprime définitivement', async () => {
    const store = new MemoryNoteStore();
    const [a, b] = await seed(store, 'A', 'B');

    expect(await updateNotes(store, [a, newId()], trashed, 10)).toBe(1);
    await deleteNotes(store, [a, b]);
    expect(await store.listNotes({ view: 'active' })).toEqual([]);
    expect(await store.listNotes({ view: 'trash' })).toEqual([]);
  });
});
