import * as SQLite from 'expo-sqlite';

import { toHex } from '@/crypto/vectors';
import { foldText, previewOf, PREVIEW_LENGTH, searchTextOf } from '@/notes/model';
import type {
  BodyFormat,
  Category,
  Note,
  NoteFilter,
  NoteStore,
  NoteSummary,
} from '@/notes/types';

/**
 * Stockage SQLite chiffré par SQLCipher. La clé (256 bits) est dérivée de la
 * clé maîtresse : sans coffre déverrouillé, le fichier est illisible.
 *
 * Les colonnes sont en clair à l'intérieur de la base chiffrée, ce qui permet
 * la recherche locale. Le chiffrement note par note n'intervient qu'à l'envoi
 * vers le serveur (phase 4).
 */

const MIGRATIONS: string[] = [
  // Version 1
  `CREATE TABLE notes (
     id TEXT PRIMARY KEY NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     body_format TEXT NOT NULL,
     plain_text TEXT NOT NULL,
     search_text TEXT NOT NULL,
     category_id TEXT,
     archived INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     deleted_at INTEGER
   );
   CREATE INDEX notes_by_update ON notes (updated_at DESC);
   CREATE TABLE categories (
     id TEXT PRIMARY KEY NOT NULL,
     name TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
];

type NoteRow = {
  id: string;
  title: string;
  body: string;
  body_format: string;
  plain_text: string;
  category_id: string | null;
  archived: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

type SummaryRow = Pick<
  NoteRow,
  'id' | 'title' | 'category_id' | 'archived' | 'updated_at' | 'deleted_at'
> & { preview: string };

type CategoryRow = { id: string; name: string; created_at: number; updated_at: number };

export function databaseName(accountId: string): string {
  return `notes-${accountId}.db`;
}

/** Échappe les jokers de LIKE dans un terme de recherche. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export class SqliteNoteStore implements NoteStore {
  private constructor(private readonly db: SQLite.SQLiteDatabase) {}

  /**
   * @throws si la clé ne correspond pas à la base existante.
   */
  static async open(accountId: string, databaseKey: Uint8Array): Promise<SqliteNoteStore> {
    const db = await SQLite.openDatabaseAsync(databaseName(accountId));
    try {
      // Clé brute en hexadécimal : SQLCipher ne la re-dérive pas (elle est déjà
      // issue d'une dérivation de clé).
      await db.execAsync(`PRAGMA key = "x'${toHex(databaseKey)}'";`);
      // Première lecture réelle : échoue ici si la clé est mauvaise.
      const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
      let version = row?.user_version ?? 0;
      while (version < MIGRATIONS.length) {
        const next = version + 1;
        await db.withTransactionAsync(async () => {
          await db.execAsync(MIGRATIONS[next - 1]);
          await db.execAsync(`PRAGMA user_version = ${next};`);
        });
        version = next;
      }
    } catch (error) {
      await db.closeAsync();
      throw error;
    }
    return new SqliteNoteStore(db);
  }

  async listNotes(filter: NoteFilter): Promise<NoteSummary[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.view === 'trash') {
      where.push('deleted_at IS NOT NULL');
    } else {
      where.push('deleted_at IS NULL', 'archived = ?');
      params.push(filter.view === 'archived' ? 1 : 0);
    }
    if (filter.categoryId !== undefined) {
      where.push('category_id = ?');
      params.push(filter.categoryId);
    }
    const search = foldText(filter.search ?? '').trim();
    if (search !== '') {
      where.push(`search_text LIKE ? ESCAPE '\\'`);
      params.push(likePattern(search));
    }
    const rows = await this.db.getAllAsync<SummaryRow>(
      `SELECT id, title, category_id, archived, updated_at, deleted_at,
              substr(plain_text, 1, ${PREVIEW_LENGTH * 4}) AS preview
         FROM notes
        WHERE ${where.join(' AND ')}
        ORDER BY updated_at DESC`,
      params,
    );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      preview: previewOf(row.preview),
      categoryId: row.category_id,
      archived: row.archived === 1,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    }));
  }

  async getNote(id: string): Promise<Note | null> {
    const row = await this.db.getFirstAsync<NoteRow>(
      `SELECT id, title, body, body_format, plain_text, category_id, archived,
              created_at, updated_at, deleted_at
         FROM notes WHERE id = ?`,
      [id],
    );
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      bodyFormat: row.body_format as BodyFormat,
      plainText: row.plain_text,
      categoryId: row.category_id,
      archived: row.archived === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }

  async saveNote(note: Note): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO notes (id, title, body, body_format, plain_text, search_text,
                          category_id, archived, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         title = excluded.title, body = excluded.body, body_format = excluded.body_format,
         plain_text = excluded.plain_text, search_text = excluded.search_text,
         category_id = excluded.category_id, archived = excluded.archived,
         updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
      [
        note.id,
        note.title,
        note.body,
        note.bodyFormat,
        note.plainText,
        searchTextOf(note),
        note.categoryId,
        note.archived ? 1 : 0,
        note.createdAt,
        note.updatedAt,
        note.deletedAt,
      ],
    );
  }

  async deleteNote(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM notes WHERE id = ?', [id]);
  }

  async emptyTrash(): Promise<void> {
    await this.db.runAsync('DELETE FROM notes WHERE deleted_at IS NOT NULL');
  }

  async listCategories(): Promise<Category[]> {
    const rows = await this.db.getAllAsync<CategoryRow>(
      'SELECT id, name, created_at, updated_at FROM categories',
    );
    return rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
      .sort((a, b) => foldText(a.name).localeCompare(foldText(b.name)));
  }

  async saveCategory(category: Category): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO categories (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      [category.id, category.name, category.createdAt, category.updatedAt],
    );
  }

  async deleteCategory(id: string, now: number): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        'UPDATE notes SET category_id = NULL, updated_at = ? WHERE category_id = ?',
        [now, id],
      );
      await this.db.runAsync('DELETE FROM categories WHERE id = ?', [id]);
    });
  }

  async close(): Promise<void> {
    await this.db.closeAsync();
  }
}

/** Supprime le fichier de base d'un compte (coffre retiré de l'appareil). */
export async function deleteNoteDatabase(accountId: string): Promise<void> {
  try {
    await SQLite.deleteDatabaseAsync(databaseName(accountId));
  } catch {
    // Base jamais créée ou déjà supprimée.
  }
}
