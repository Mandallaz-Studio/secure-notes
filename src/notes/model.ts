import sodium from 'react-native-libsodium';

import type {
  Attachment,
  BodyContent,
  Category,
  Note,
  NoteFilter,
  NoteSort,
  NoteSummary,
  NoteView,
} from '@/notes/types';

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
    pinned: note.pinned,
    hidden: note.hidden,
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
  if (filter.hidden !== undefined && note.hidden !== filter.hidden) return false;
  if (filter.categoryId !== undefined && note.categoryId !== filter.categoryId) return false;
  const search = foldText(filter.search ?? '').trim();
  return search === '' || searchTextOf(note).includes(search);
}

export function createNote(
  now: number,
  categoryId: string | null = null,
  hidden = false,
): Note {
  return {
    id: newId(),
    title: '',
    body: '',
    bodyFormat: 'text',
    plainText: '',
    categoryId,
    archived: false,
    pinned: false,
    hidden,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    attachments: [],
  };
}

/** Une note jamais remplie n'est pas conservée. */
export function isBlank(note: Pick<Note, 'title' | 'plainText' | 'attachments'>): boolean {
  return note.title.trim() === '' && note.plainText.trim() === '' && note.attachments.length === 0;
}

export function withAttachments(note: Note, attachments: Attachment[], now: number): Note {
  return { ...note, attachments, updatedAt: now };
}

export function withText(note: Note, title: string, text: string, now: number): Note {
  return { ...note, title, body: text, bodyFormat: 'text', plainText: text, updatedAt: now };
}

export function withTitle(note: Note, title: string, now: number): Note {
  return { ...note, title, updatedAt: now };
}

/** Remplace le contenu de la note, dans le format fourni par l'éditeur. */
export function withBody(note: Note, content: BodyContent, now: number): Note {
  return { ...note, ...content, updatedAt: now };
}

export function withCategory(note: Note, categoryId: string | null, now: number): Note {
  return { ...note, categoryId, updatedAt: now };
}

export function withArchived(note: Note, archived: boolean, now: number): Note {
  return { ...note, archived, updatedAt: now };
}

export function withPinned(note: Note, pinned: boolean, now: number): Note {
  return { ...note, pinned, updatedAt: now };
}

/** Entre dans le dossier privé (`true`) ou en sort. */
export function withHidden(note: Note, hidden: boolean, now: number): Note {
  return { ...note, hidden, updatedAt: now };
}

export const DEFAULT_SORT: NoteSort = 'updated-desc';

const titleCollator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/**
 * Compare deux titres ; les notes sans titre vont toujours en fin de liste,
 * quel que soit le sens.
 */
function compareTitles(a: string, b: string, direction: 1 | -1): number {
  const ta = a.trim();
  const tb = b.trim();
  if (ta === '' || tb === '') return Number(ta === '') - Number(tb === '');
  return direction * titleCollator.compare(ta, tb);
}

/**
 * Ordre des listes selon `sort` (par défaut, les plus récemment modifiées
 * d'abord) ; hors de la corbeille, les notes mises en avant passent devant. À
 * titre égal, la plus récemment modifiée d'abord.
 */
export function compareNotes(view: NoteView, sort: NoteSort = DEFAULT_SORT) {
  type Sortable = Pick<Note, 'title' | 'pinned' | 'updatedAt'>;
  return (a: Sortable, b: Sortable) => {
    const pinned = view !== 'trash' ? Number(b.pinned) - Number(a.pinned) : 0;
    if (pinned !== 0) return pinned;
    switch (sort) {
      case 'title-asc':
      case 'title-desc':
        return (
          compareTitles(a.title, b.title, sort === 'title-asc' ? 1 : -1) || b.updatedAt - a.updatedAt
        );
      case 'updated-asc':
        return a.updatedAt - b.updatedAt;
      case 'updated-desc':
        return b.updatedAt - a.updatedAt;
    }
  };
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
