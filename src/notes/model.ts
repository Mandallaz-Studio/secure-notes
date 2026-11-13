import sodium from 'react-native-libsodium';

import type { Category, Note, NoteFilter, NoteSummary } from '@/notes/types';

export const PREVIEW_LENGTH = 140;

/** Identifiant aléatoire au format UUID v4. */
export function newId(): string {
  const bytes = sodium.randombytes_buf(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Minuscules, sans accents : forme utilisée pour comparer lors d'une recherche. */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Texte indexé pour la recherche : titre et contenu, repliés. */
export function searchTextOf(note: Pick<Note, 'title' | 'plainText'>): string {
  return foldText(`${note.title}\n${note.plainText}`);
}

export function previewOf(plainText: string): string {
  return plainText.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH);
}

export function summarize(note: Note): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    preview: previewOf(note.plainText),
    categoryId: note.categoryId,
    archived: note.archived,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt,
  };
}

export function matchesFilter(note: Note, filter: NoteFilter): boolean {
  const inView =
    filter.view === 'trash'
      ? note.deletedAt !== null
      : note.deletedAt === null && note.archived === (filter.view === 'archived');
  if (!inView) return false;
  if (filter.categoryId !== undefined && note.categoryId !== filter.categoryId) return false;
  const search = foldText(filter.search ?? '').trim();
  return search === '' || searchTextOf(note).includes(search);
}

export function createNote(now: number, categoryId: string | null = null): Note {
  return {
    id: newId(),
    title: '',
    body: '',
    bodyFormat: 'text',
    plainText: '',
    categoryId,
    archived: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

/** Une note jamais remplie n'est pas conservée. */
export function isBlank(note: Pick<Note, 'title' | 'plainText'>): boolean {
  return note.title.trim() === '' && note.plainText.trim() === '';
}

export function withText(note: Note, title: string, text: string, now: number): Note {
  return { ...note, title, body: text, bodyFormat: 'text', plainText: text, updatedAt: now };
}

export function withCategory(note: Note, categoryId: string | null, now: number): Note {
  return { ...note, categoryId, updatedAt: now };
}

export function withArchived(note: Note, archived: boolean, now: number): Note {
  return { ...note, archived, updatedAt: now };
}

export function trashed(note: Note, now: number): Note {
  return { ...note, deletedAt: now, updatedAt: now };
}

/** Sort la note de la corbeille ; elle retrouve son état archivé ou non. */
export function restored(note: Note, now: number): Note {
  return { ...note, deletedAt: null, updatedAt: now };
}

export function createCategory(name: string, now: number): Category {
  return { id: newId(), name: name.trim(), createdAt: now, updatedAt: now };
}

export function renamed(category: Category, name: string, now: number): Category {
  return { ...category, name: name.trim(), updatedAt: now };
}
