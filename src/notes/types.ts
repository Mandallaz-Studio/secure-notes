/**
 * Format du corps d'une note. `text` : texte brut (phase 2). `tiptap` : document
 * JSON de l'éditeur riche (phase 3).
 */
export type BodyFormat = 'text' | 'tiptap';

export type Note = {
  id: string;
  title: string;
  /** Contenu sérialisé selon `bodyFormat`. */
  body: string;
  bodyFormat: BodyFormat;
  /** Texte brut du corps, pour l'aperçu et la recherche. */
  plainText: string;
  categoryId: string | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  /** Date de mise à la corbeille, ou `null` si la note n'y est pas. */
  deletedAt: number | null;
};

export type NoteSummary = Pick<
  Note,
  'id' | 'title' | 'categoryId' | 'archived' | 'updatedAt' | 'deletedAt'
> & {
  /** Début du texte de la note. */
  preview: string;
};

export type Category = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type NoteView = 'active' | 'archived' | 'trash';

export type NoteFilter = {
  view: NoteView;
  /** Absent : toutes les catégories. */
  categoryId?: string;
  /** Recherche dans le titre et le texte, insensible à la casse et aux accents. */
  search?: string;
};

/**
 * Stockage des notes. Deux implémentations : SQLite chiffrée (SQLCipher) sur
 * mobile, mémoire sur le web et dans les tests. Les listes sont triées de la
 * note la plus récemment modifiée à la plus ancienne.
 */
export interface NoteStore {
  listNotes(filter: NoteFilter): Promise<NoteSummary[]>;
  getNote(id: string): Promise<Note | null>;
  /** Crée la note ou remplace celle qui porte le même identifiant. */
  saveNote(note: Note): Promise<void>;
  deleteNote(id: string): Promise<void>;
  /** Supprime définitivement toutes les notes de la corbeille. */
  emptyTrash(): Promise<void>;

  listCategories(): Promise<Category[]>;
  saveCategory(category: Category): Promise<void>;
  /** Supprime la catégorie ; ses notes deviennent sans catégorie. */
  deleteCategory(id: string, now: number): Promise<void>;

  close(): Promise<void>;
}
