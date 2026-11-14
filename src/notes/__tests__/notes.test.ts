import { cryptoReady } from '@/crypto/aead';
import { MemoryNoteStore } from '@/notes/memory-store';
import {
  createCategory,
  createNote,
  foldText,
  isBlank,
  newId,
  PREVIEW_LENGTH,
  previewOf,
  renamed,
  restored,
  trashed,
  withArchived,
  withCategory,
  withHidden,
  withPinned,
  withText,
} from '@/notes/model';
import type { Note, NoteStore } from '@/notes/types';

beforeAll(async () => {
  await cryptoReady();
});

let store: NoteStore;
let clock: number;
const tick = () => (clock += 1000);

/** Crée et enregistre une note avec un titre et un texte. */
async function add(title: string, text = '', categoryId: string | null = null): Promise<Note> {
  const note = withText(createNote(tick(), categoryId), title, text, clock);
  await store.saveNote(note);
  return note;
}

const titles = async (...args: Parameters<NoteStore['listNotes']>) =>
  (await store.listNotes(...args)).map((note) => note.title);

beforeEach(() => {
  store = new MemoryNoteStore();
  clock = 1_700_000_000_000;
});

describe('modèle', () => {
  it('génère des identifiants UUID v4 distincts', () => {
    const ids = new Set(Array.from({ length: 200 }, newId));

    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('replie casse et accents pour la recherche', () => {
    expect(foldText('Éléphant ÇA où')).toBe('elephant ca ou');
  });

  it('construit un aperçu court sur une ligne', () => {
    expect(previewOf('  ligne 1\n\n  ligne 2  ')).toBe('ligne 1 ligne 2');
    expect(previewOf('x'.repeat(500))).toHaveLength(PREVIEW_LENGTH);
  });

  it('reconnaît une note vide', () => {
    const note = createNote(1);

    expect(isBlank(note)).toBe(true);
    expect(isBlank(withText(note, '  ', '\n', 2))).toBe(true);
    expect(isBlank(withText(note, '', 'contenu', 2))).toBe(false);
  });

  it('met à jour la date de modification à chaque changement', () => {
    const note = createNote(1);

    expect(withText(note, 't', 'c', 2).updatedAt).toBe(2);
    expect(withCategory(note, 'cat', 3).updatedAt).toBe(3);
    expect(withArchived(note, true, 4).updatedAt).toBe(4);
    expect(trashed(note, 5)).toMatchObject({ deletedAt: 5, updatedAt: 5 });
    expect(restored(trashed(note, 5), 6)).toMatchObject({ deletedAt: null, updatedAt: 6 });
    expect(note.createdAt).toBe(1);
  });
});

describe('stockage des notes', () => {
  it('enregistre, relit et remplace une note', async () => {
    const note = await add('Courses', 'pain\nlait');

    expect(await store.getNote(note.id)).toEqual(note);

    const edited = withText(note, 'Courses du samedi', 'pain', tick());
    await store.saveNote(edited);

    expect(await store.getNote(note.id)).toEqual(edited);
    expect(await titles({ view: 'active' })).toEqual(['Courses du samedi']);
    expect(await store.getNote('inconnu')).toBeNull();
  });

  it('trie de la plus récente à la plus ancienne et fournit un aperçu', async () => {
    const first = await add('Première', 'texte de la première');
    await add('Deuxième');
    await store.saveNote(withText(first, 'Première', 'modifiée', tick()));

    const list = await store.listNotes({ view: 'active' });

    expect(list.map((note) => note.title)).toEqual(['Première', 'Deuxième']);
    expect(list[0].preview).toBe('modifiée');
  });

  it('place les notes mises en avant en tête, y compris dans une catégorie', async () => {
    const work = newId();
    const oldPinned = await add('Ancienne en avant', '', work);
    await add('Récente');
    await add('Récente du travail', '', work);
    const otherPinned = await add('En avant ailleurs');
    await store.saveNote(withPinned(oldPinned, true, oldPinned.updatedAt));
    await store.saveNote(withPinned(otherPinned, true, otherPinned.updatedAt));

    expect(await titles({ view: 'active' })).toEqual([
      'En avant ailleurs',
      'Ancienne en avant',
      'Récente du travail',
      'Récente',
    ]);
    expect(await titles({ view: 'active', categoryId: work })).toEqual([
      'Ancienne en avant',
      'Récente du travail',
    ]);
    // Dans la corbeille, seul compte l'ordre de suppression.
    await store.saveNote(trashed(withPinned(oldPinned, true, tick()), tick()));
    await store.saveNote(trashed((await store.getNote(otherPinned.id))!, tick()));
    const third = await add('Troisième');
    await store.saveNote(trashed(third, tick()));
    expect(await titles({ view: 'trash' })).toEqual([
      'Troisième',
      'En avant ailleurs',
      'Ancienne en avant',
    ]);
  });

  it('sépare le dossier privé des autres notes, jusque dans la corbeille', async () => {
    await add('Ordinaire', 'mot commun');
    const secret = await add('Secrète', 'mot commun');
    const thrown = await add('Secrète jetée');
    const plain = await add('Ordinaire jetée');
    await store.saveNote(withHidden(secret, true, tick()));
    await store.saveNote(trashed(withHidden(thrown, true, tick()), tick()));
    await store.saveNote(trashed(plain, tick()));

    expect(await titles({ view: 'active', hidden: false, search: 'commun' })).toEqual(['Ordinaire']);
    expect(await titles({ view: 'active', hidden: true })).toEqual(['Secrète']);
    expect(await titles({ view: 'trash', hidden: false })).toEqual(['Ordinaire jetée']);
    // Sans précision (copie, export), toutes les notes.
    expect(await titles({ view: 'active' })).toEqual(['Secrète', 'Ordinaire']);

    await store.emptyTrash(false);
    expect(await titles({ view: 'trash' })).toEqual(['Secrète jetée']);
    await store.emptyTrash(true);
    expect(await titles({ view: 'trash' })).toEqual([]);
  });

  it('sépare notes actives, archives et corbeille', async () => {
    const active = await add('Active');
    const archived = await add('Archivée');
    const deleted = await add('Supprimée');
    const archivedThenDeleted = await add('Archivée puis supprimée');
    await store.saveNote(withArchived(archived, true, tick()));
    await store.saveNote(trashed(deleted, tick()));
    await store.saveNote(trashed(withArchived(archivedThenDeleted, true, tick()), tick()));

    expect(await titles({ view: 'active' })).toEqual([active.title]);
    expect(await titles({ view: 'archived' })).toEqual([archived.title]);
    expect(await titles({ view: 'trash' })).toEqual([archivedThenDeleted.title, deleted.title]);
  });

  it('restaure une note de la corbeille dans son état précédent', async () => {
    const note = await add('Archivée');
    const inTrash = trashed(withArchived(note, true, tick()), tick());
    await store.saveNote(inTrash);
    await store.saveNote(restored(inTrash, tick()));

    expect(await titles({ view: 'trash' })).toEqual([]);
    expect(await titles({ view: 'archived' })).toEqual(['Archivée']);
  });

  it('vide la corbeille sans toucher au reste', async () => {
    await add('Gardée');
    await store.saveNote(trashed(await add('Jetée 1'), tick()));
    await store.saveNote(trashed(await add('Jetée 2'), tick()));

    await store.emptyTrash();

    expect(await titles({ view: 'trash' })).toEqual([]);
    expect(await titles({ view: 'active' })).toEqual(['Gardée']);
  });

  it('supprime définitivement une note', async () => {
    const note = await add('Éphémère');
    await store.deleteNote(note.id);

    expect(await store.getNote(note.id)).toBeNull();
  });

  it('cherche dans le titre et le texte, sans tenir compte de la casse ni des accents', async () => {
    await add('Réunion équipe', 'ordre du jour');
    await add('Recette', 'Crème brûlée et café');
    await add('Divers', 'rien à voir');

    expect(await titles({ view: 'active', search: 'REUNION' })).toEqual(['Réunion équipe']);
    expect(await titles({ view: 'active', search: 'creme brulee' })).toEqual(['Recette']);
    expect(await titles({ view: 'active', search: '  ' })).toHaveLength(3);
    expect(await titles({ view: 'active', search: 'absent' })).toEqual([]);
  });

  it('traite % et _ comme du texte dans une recherche', async () => {
    await add('Remise', '50% de réduction');
    await add('Code', 'nom_de_variable');
    await add('Autre', 'texte quelconque');

    expect(await titles({ view: 'active', search: '%' })).toEqual(['Remise']);
    expect(await titles({ view: 'active', search: '_de_' })).toEqual(['Code']);
  });

  it('limite la recherche à la vue demandée', async () => {
    await add('Projet actif', 'budget');
    await store.saveNote(withArchived(await add('Projet archivé', 'budget'), true, tick()));

    expect(await titles({ view: 'active', search: 'budget' })).toEqual(['Projet actif']);
    expect(await titles({ view: 'archived', search: 'budget' })).toEqual(['Projet archivé']);
  });
});

describe('catégories', () => {
  it('liste les catégories par ordre alphabétique, accents compris', async () => {
    for (const name of ['Travail', 'école', 'Maison']) {
      await store.saveCategory(createCategory(name, tick()));
    }

    expect((await store.listCategories()).map((c) => c.name)).toEqual([
      'école',
      'Maison',
      'Travail',
    ]);
  });

  it('renomme une catégorie', async () => {
    const category = createCategory(' Perso ', tick());
    await store.saveCategory(category);
    await store.saveCategory(renamed(category, 'Personnel', tick()));

    expect(category.name).toBe('Perso');
    expect((await store.listCategories()).map((c) => c.name)).toEqual(['Personnel']);
  });

  it('filtre les notes par catégorie', async () => {
    const work = createCategory('Travail', tick());
    const home = createCategory('Maison', tick());
    await store.saveCategory(work);
    await store.saveCategory(home);
    await add('Rapport', '', work.id);
    await add('Jardin', '', home.id);
    await add('Sans catégorie');

    expect(await titles({ view: 'active', categoryId: work.id })).toEqual(['Rapport']);
    expect(await titles({ view: 'active' })).toHaveLength(3);
  });

  it('laisse les notes sans catégorie quand la leur est supprimée', async () => {
    const work = createCategory('Travail', tick());
    await store.saveCategory(work);
    const note = await add('Rapport', '', work.id);
    const other = await add('Autre');

    await store.deleteCategory(work.id, tick());

    expect(await store.listCategories()).toEqual([]);
    expect(await store.getNote(note.id)).toMatchObject({ categoryId: null, updatedAt: clock });
    expect(await store.getNote(other.id)).toEqual(other);
  });
});
