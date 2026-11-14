/**
 * Format du corps d'une note. `text` : texte brut (phase 2). `tiptap` : document
 * JSON de l'éditeur riche (phase 3).
 */
export type BodyFormat = 'text' | 'tiptap';

/** Fichier joint à une note. Son contenu est un « blob » chiffré, stocké à part. */
export type Attachment = {
  /** Identifiant du blob. */
  id: string;
  name: string;
  /** Type MIME annoncé à l'ajout. */
  mime: string;
  /** Taille en octets. */
  size: number;
};

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
  /** Note mise en avant : affichée en tête des listes. */
  pinned: boolean;
  /** Note du dossier privé : absente des listes ordinaires. */
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
  /** Date de mise à la corbeille, ou `null` si la note n'y est pas. */
  deletedAt: number | null;
  /** Fichiers joints. Les images du texte n'y figurent pas : le document les référence. */
  attachments: Attachment[];
};

/**
 * État local d'un blob (image d'une note ou fichier joint). Un blob ne change
 * jamais : un nouveau contenu reçoit un nouvel identifiant.
 */
export type BlobState = {
  id: string;
  /** Le contenu est sur cet appareil. */
  hasData: boolean;
  /** Le contenu est sur le serveur (à la connaissance de cet appareil). */
  uploaded: boolean;
  /** Au moins une note, corbeille comprise, y fait référence. */
  referenced: boolean;
  /** Taille en octets ; 0 tant que le contenu n'est pas là. */
  size: number;
  /** Date d'arrivée sur cet appareil ; 0 tant que le contenu n'est pas là. */
  createdAt: number;
};

/** Contenu d'une note tel que l'éditeur le fournit. */
export type BodyContent = Pick<Note, 'body' | 'bodyFormat' | 'plainText'>;

export type NoteSummary = Pick<
  Note,
  'id' | 'title' | 'categoryId' | 'archived' | 'pinned' | 'hidden' | 'updatedAt' | 'deletedAt'
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

/** Ordre des listes : par titre (A → Z ou Z → A) ou par date de modification. */
export type NoteSort = 'title-asc' | 'title-desc' | 'updated-desc' | 'updated-asc';

export type NoteFilter = {
  view: NoteView;
  /** Absent : les plus récemment modifiées d'abord. */
  sort?: NoteSort;
  /** Absent : toutes les catégories. */
  categoryId?: string;
  /** Recherche dans le titre et le texte, insensible à la casse et aux accents. */
  search?: string;
  /**
   * `true` : notes du dossier privé seulement ; `false` : les autres.
   * Absent : toutes (copie, export…) — un écran précise toujours.
   */
  hidden?: boolean;
};

/**
 * Stockage des notes. Deux implémentations : SQLite chiffrée (SQLCipher) sur
 * mobile, mémoire sur le web et dans les tests. Les listes suivent l'ordre
 * `filter.sort` (par défaut, de la note la plus récemment modifiée à la plus
 * ancienne), les notes mises en avant d'abord (sauf dans la corbeille).
 */
export interface NoteStore {
  listNotes(filter: NoteFilter): Promise<NoteSummary[]>;
  getNote(id: string): Promise<Note | null>;
  /** Crée la note ou remplace celle qui porte le même identifiant. */
  saveNote(note: Note): Promise<void>;
  deleteNote(id: string): Promise<void>;
  /**
   * Supprime définitivement les notes de la corbeille : celles du dossier
   * privé (`hidden` vrai), les autres (faux), ou toutes (absent).
   */
  emptyTrash(hidden?: boolean): Promise<void>;

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
   * Plus récente date de modification (`updatedAt`) d'une version de
   * l'élément échangée avec le serveur (reçue ou envoyée), gardée même après
   * la suppression de l'élément ; `null` s'il n'a jamais été synchronisé.
   */
  getVersionFloor(id: string): Promise<number | null>;
  /**
   * La version `seq` du serveur est écartée, car plus ancienne que ce que cet
   * appareil connaît : l'élément local, ou sa suppression s'il n'existe plus,
   * sera renvoyé pour la remplacer.
   */
  requeue(id: string, seq: number): Promise<void>;
  /**
   * L'élément a été envoyé tel que décrit par `entry` et porte le numéro `seq`.
   * Il reste « à envoyer » s'il a été modifié entre-temps.
   */
  markPushed(entry: SyncEntry, seq: number): Promise<void>;
  /** Enregistre un blob créé sur cet appareil : il est « à envoyer ». */
  putBlob(id: string, data: Uint8Array): Promise<void>;
  /** Parmi `ids`, ceux dont le contenu n'est pas sur cet appareil. */
  missingBlobs(ids: string[]): Promise<string[]>;
  /** Contenu d'un blob ; `null` s'il n'est pas (encore) sur cet appareil. */
  getBlob(id: string): Promise<Uint8Array | null>;
  /** Blobs présents sur l'appareil ou référencés par une note. */
  listBlobs(): Promise<BlobState[]>;
  /** Enregistre un blob téléchargé du serveur. */
  storeRemoteBlob(id: string, data: Uint8Array): Promise<void>;
  setBlobUploaded(id: string, uploaded: boolean): Promise<void>;
  deleteBlob(id: string): Promise<void>;

  getSyncValue(key: string): Promise<string | null>;
  setSyncValue(key: string, value: string): Promise<void>;
  /** Oublie tout état de synchronisation : tout est à renvoyer (changement d'instance). */
  resetSync(): Promise<void>;

  close(): Promise<void>;
}

/** Contenu synchronisé : une note ou une catégorie. */
export type SyncItem = { kind: 'note'; note: Note } | { kind: 'category'; category: Category };

/** Changement reçu du serveur. */
export type RemoteChange =
  | SyncItem
  /**
   * `lastUpdatedAt` : date de modification de la dernière version supprimée,
   * si l'appareil qui a supprimé la connaissait (absente des anciennes versions).
   */
  | { kind: 'deleted'; id: string; lastUpdatedAt?: number };

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
