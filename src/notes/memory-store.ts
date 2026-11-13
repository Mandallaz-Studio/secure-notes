import { foldText, matchesFilter, summarize } from '@/notes/model';
import type { Category, Note, NoteFilter, NoteStore, NoteSummary } from '@/notes/types';

/**
 * Stockage en mémoire : utilisé sur le web (rien n'y est conservé) et comme
 * référence de comportement dans les tests.
 */
export class MemoryNoteStore implements NoteStore {
  private notes = new Map<string, Note>();
  private categories = new Map<string, Category>();

  async listNotes(filter: NoteFilter): Promise<NoteSummary[]> {
    return [...this.notes.values()]
      .filter((note) => matchesFilter(note, filter))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(summarize);
  }

  async getNote(id: string): Promise<Note | null> {
    const note = this.notes.get(id);
    return note ? { ...note } : null;
  }

  async saveNote(note: Note): Promise<void> {
    this.notes.set(note.id, { ...note });
  }

  async deleteNote(id: string): Promise<void> {
    this.notes.delete(id);
  }

  async emptyTrash(): Promise<void> {
    for (const note of this.notes.values()) {
      if (note.deletedAt !== null) this.notes.delete(note.id);
    }
  }

  async listCategories(): Promise<Category[]> {
    return [...this.categories.values()]
      .map((category) => ({ ...category }))
      .sort((a, b) => foldText(a.name).localeCompare(foldText(b.name)));
  }

  async saveCategory(category: Category): Promise<void> {
    this.categories.set(category.id, { ...category });
  }

  async deleteCategory(id: string, now: number): Promise<void> {
    this.categories.delete(id);
    for (const note of this.notes.values()) {
      if (note.categoryId === id) {
        this.notes.set(note.id, { ...note, categoryId: null, updatedAt: now });
      }
    }
  }

  async close(): Promise<void> {
    this.notes.clear();
    this.categories.clear();
  }
}
