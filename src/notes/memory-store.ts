import { blobIdsOf } from '@/notes/blobs';
import { compareNotes, foldText, matchesFilter, summarize } from '@/notes/model';
import type {
  BlobState,
  Category,
  Note,
  NoteFilter,
  NoteStore,
  NoteSummary,
  RemoteChange,
  SyncEntry,
} from '@/notes/types';

type Meta = { dirty: boolean; serverSeq: number | null };

const NEW: Meta = { dirty: true, serverSeq: null };

/**
 * Stockage en mémoire : utilisé sur le web (rien n'y est conservé) et comme
 * référence de comportement dans les tests.
 */
export class MemoryNoteStore implements NoteStore {
  private notes = new Map<string, Note>();
  private categories = new Map<string, Category>();
  /** État de synchronisation des notes et des catégories. */
  private meta = new Map<string, Meta>();
  /** Suppressions à envoyer : identifiant → version du serveur à remplacer. */
  private tombstones = new Map<string, number>();
  private syncValues = new Map<string, string>();
  private blobs = new Map<string, { data: Uint8Array; uploaded: boolean; createdAt: number }>();

  async listNotes(filter: NoteFilter): Promise<NoteSummary[]> {
    return [...this.notes.values()]
      .filter((note) => matchesFilter(note, filter))
      .sort(compareNotes(filter.view))
      .map(summarize);
  }

  async getNote(id: string): Promise<Note | null> {
    const note = this.notes.get(id);
    return note ? { ...note } : null;
  }

  async saveNote(note: Note): Promise<void> {
    this.notes.set(note.id, { ...note });
    this.touch(note.id);
  }

  async deleteNote(id: string): Promise<void> {
    if (this.notes.delete(id)) this.bury(id);
  }

  async emptyTrash(hidden?: boolean): Promise<void> {
    for (const note of [...this.notes.values()]) {
      if (note.deletedAt !== null && (hidden === undefined || note.hidden === hidden)) {
        await this.deleteNote(note.id);
      }
    }
  }

  async listCategories(): Promise<Category[]> {
    return [...this.categories.values()]
      .map((category) => ({ ...category }))
      .sort((a, b) => foldText(a.name).localeCompare(foldText(b.name)));
  }

  async saveCategory(category: Category): Promise<void> {
    this.categories.set(category.id, { ...category });
    this.touch(category.id);
  }

  async deleteCategory(id: string, now: number): Promise<void> {
    if (this.categories.delete(id)) this.bury(id);
    for (const note of [...this.notes.values()]) {
      if (note.categoryId === id) {
        await this.saveNote({ ...note, categoryId: null, updatedAt: now });
      }
    }
  }

  /** Marque l'élément « à envoyer » ; s'il renaît après suppression, il garde sa version. */
  private touch(id: string): void {
    const serverSeq = this.tombstones.get(id) ?? this.meta.get(id)?.serverSeq ?? null;
    this.tombstones.delete(id);
    this.meta.set(id, { dirty: true, serverSeq });
  }

  /** Garde une trace de la suppression si le serveur connaît l'élément. */
  private bury(id: string): void {
    const serverSeq = this.meta.get(id)?.serverSeq ?? null;
    this.meta.delete(id);
    if (serverSeq !== null) this.tombstones.set(id, serverSeq);
  }

  private entryOf(id: string): SyncEntry | null {
    const tombstone = this.tombstones.get(id);
    if (tombstone !== undefined) {
      return { kind: 'tombstone', id, dirty: true, serverSeq: tombstone };
    }
    const meta = this.meta.get(id) ?? NEW;
    const note = this.notes.get(id);
    if (note) return { kind: 'note', id, note: { ...note }, ...meta };
    const category = this.categories.get(id);
    if (category) return { kind: 'category', id, category: { ...category }, ...meta };
    return null;
  }

  async listPending(): Promise<SyncEntry[]> {
    const ids = [...this.categories.keys(), ...this.notes.keys(), ...this.tombstones.keys()];
    return ids
      .map((id) => this.entryOf(id))
      .filter((entry): entry is SyncEntry => entry !== null && entry.dirty);
  }

  async getSyncEntry(id: string): Promise<SyncEntry | null> {
    return this.entryOf(id);
  }

  async applyRemote(change: RemoteChange, seq: number): Promise<void> {
    const id =
      change.kind === 'note'
        ? change.note.id
        : change.kind === 'category'
          ? change.category.id
          : change.id;
    this.notes.delete(id);
    this.categories.delete(id);
    this.tombstones.delete(id);
    this.meta.delete(id);
    if (change.kind === 'deleted') return;
    if (change.kind === 'note') this.notes.set(id, { ...change.note });
    else this.categories.set(id, { ...change.category });
    this.meta.set(id, { dirty: false, serverSeq: seq });
  }

  async setServerSeq(id: string, seq: number): Promise<void> {
    if (this.tombstones.has(id)) this.tombstones.set(id, seq);
    else if (this.notes.has(id) || this.categories.has(id)) {
      this.meta.set(id, { dirty: true, serverSeq: seq });
    }
  }

  async markPushed(entry: SyncEntry, seq: number): Promise<void> {
    if (entry.kind === 'tombstone') {
      // Recréé entre-temps : `touch` a déjà repris la trace à son compte.
      if (this.tombstones.get(entry.id) === entry.serverSeq) this.tombstones.delete(entry.id);
      return;
    }
    const current =
      entry.kind === 'note' ? this.notes.get(entry.id) : this.categories.get(entry.id);
    if (!current) {
      // Supprimé pendant l'envoi : le serveur doit encore l'apprendre.
      this.tombstones.set(entry.id, seq);
      return;
    }
    const sent = entry.kind === 'note' ? entry.note : entry.category;
    this.meta.set(entry.id, { dirty: current.updatedAt !== sent.updatedAt, serverSeq: seq });
  }

  async putBlob(id: string, data: Uint8Array): Promise<void> {
    if (!this.blobs.has(id)) {
      this.blobs.set(id, { data: data.slice(), uploaded: false, createdAt: Date.now() });
    }
  }

  async missingBlobs(ids: string[]): Promise<string[]> {
    return ids.filter((id) => !this.blobs.has(id));
  }

  async getBlob(id: string): Promise<Uint8Array | null> {
    return this.blobs.get(id)?.data.slice() ?? null;
  }

  async listBlobs(): Promise<BlobState[]> {
    const referenced = new Set([...this.notes.values()].flatMap(blobIdsOf));
    const states: BlobState[] = [...this.blobs].map(([id, blob]) => ({
      id,
      hasData: true,
      uploaded: blob.uploaded,
      referenced: referenced.has(id),
      size: blob.data.length,
      createdAt: blob.createdAt,
    }));
    for (const id of referenced) {
      if (!this.blobs.has(id)) {
        states.push({ id, hasData: false, uploaded: false, referenced: true, size: 0, createdAt: 0 });
      }
    }
    return states;
  }

  async storeRemoteBlob(id: string, data: Uint8Array): Promise<void> {
    this.blobs.set(id, { data: data.slice(), uploaded: true, createdAt: Date.now() });
  }

  async setBlobUploaded(id: string, uploaded: boolean): Promise<void> {
    const blob = this.blobs.get(id);
    if (blob) blob.uploaded = uploaded;
  }

  async deleteBlob(id: string): Promise<void> {
    this.blobs.delete(id);
  }

  async getSyncValue(key: string): Promise<string | null> {
    return this.syncValues.get(key) ?? null;
  }

  async setSyncValue(key: string, value: string): Promise<void> {
    this.syncValues.set(key, value);
  }

  async resetSync(): Promise<void> {
    for (const blob of this.blobs.values()) blob.uploaded = false;
    this.meta.clear();
    this.tombstones.clear();
    this.syncValues.clear();
  }

  async close(): Promise<void> {
    this.notes.clear();
    this.categories.clear();
    this.meta.clear();
    this.tombstones.clear();
    this.syncValues.clear();
    this.blobs.clear();
  }
}
