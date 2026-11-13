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

/** Contenu d'une note tel que l'éditeur le fournit. */
export type BodyContent = Pick<Note, 'body' | 'bodyFormat' | 'plainText'>;

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

  // --- Synchronisation -----------------------------------------------------
  // Chaque écriture ci-dessus marque l'élément « à envoyer ». Une suppression
  // définitive laisse une trace tant que le serveur n'en a pas été informé.

  /** Éléments modifiés ou supprimés depuis leur dernier envoi. */
  listPending(): Promise<SyncEntry[]>;
  getSyncEntry(id: string): Promise<SyncEntry | null>;
  /** Écrit la version du serveur : l'élément n'est plus « à envoyer ». */
  applyRemote(change: RemoteChange, seq: number): Promise<void>;
  /** Note que l'élément local, toujours à envoyer, remplace la version `seq` du serveur. */
  setServerSeq(id: string, seq: number): Promise<void>;
  /**
   * L'élément a été envoyé tel que décrit par `entry` et porte le numéro `seq`.
   * Il reste « à envoyer » s'il a été modifié entre-temps.
   */
  markPushed(entry: SyncEntry, seq: number): Promise<void>;
  getSyncValue(key: string): Promise<string | null>;
  setSyncValue(key: string, value: string): Promise<void>;
  /** Oublie tout état de synchronisation : tout est à renvoyer (changement d'instance). */
  resetSync(): Promise<void>;

  close(): Promise<void>;
}

/** Contenu synchronisé : une note ou une catégorie. */
export type SyncItem = { kind: 'note'; note: Note } | { kind: 'category'; category: Category };

/** Changement reçu du serveur. */
export type RemoteChange = SyncItem | { kind: 'deleted'; id: string };

type SyncMeta = {
  id: string;
  /** Modifié depuis le dernier envoi. */
  dirty: boolean;
  /** Numéro de la version du serveur que l'élément local remplace ; `null` : jamais envoyé. */
  serverSeq: number | null;
};

/** État local d'un élément vis-à-vis du serveur. */
export type SyncEntry =
  | (SyncItem & SyncMeta)
  /** Suppression définitive, pas encore envoyée. */
  | { kind: 'tombstone'; id: string; dirty: true; serverSeq: number };
