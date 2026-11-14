import * as SQLite from 'expo-sqlite';

import { toHex } from '@/crypto/vectors';
import { blobIdsOf } from '@/notes/blobs';
import { compareNotes, foldText, previewOf, PREVIEW_LENGTH, searchTextOf } from '@/notes/model';
import type {
  Attachment,
  BlobState,
  BodyFormat,
  Category,
  Note,
  NoteFilter,
  NoteStore,
  NoteSummary,
  RemoteChange,
  SyncEntry,
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
  // Version 2 : état de synchronisation. Tout ce qui existe déjà est « à envoyer ».
  `ALTER TABLE notes ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
   ALTER TABLE notes ADD COLUMN server_seq INTEGER;
   ALTER TABLE categories ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
   ALTER TABLE categories ADD COLUMN server_seq INTEGER;
   CREATE TABLE tombstones (
     id TEXT PRIMARY KEY NOT NULL,
     server_seq INTEGER NOT NULL
   );
   CREATE TABLE sync_state (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );`,
  // Version 3 : fichiers joints et images, stockés à part des notes (« blobs »).
  `ALTER TABLE notes ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
   CREATE TABLE blobs (
     id TEXT PRIMARY KEY NOT NULL,
     data BLOB NOT NULL,
     size INTEGER NOT NULL,
     uploaded INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE note_blobs (
     note_id TEXT NOT NULL,
     blob_id TEXT NOT NULL,
     PRIMARY KEY (note_id, blob_id)
   );
   CREATE INDEX note_blobs_by_blob ON note_blobs (blob_id);`,
  // Version 4 : notes mises en avant.
  `ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`,
  // Version 5 : dossier privé.
  `ALTER TABLE notes ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;`,
];

type NoteRow = {
  id: string;
  title: string;
  body: string;
  body_format: string;
  plain_text: string;
  category_id: string | null;
  archived: number;
  pinned: number;
  hidden: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  attachments: string;
};

type SummaryRow = Pick<
  NoteRow,
  'id' | 'title' | 'category_id' | 'archived' | 'pinned' | 'hidden' | 'updated_at' | 'deleted_at'
> & { preview: string };

type CategoryRow = { id: string; name: string; created_at: number; updated_at: number };

type SyncColumns = { dirty: number; server_seq: number | null };

const NOTE_COLUMNS = `id, title, body, body_format, plain_text, category_id, archived,
                      pinned, hidden, created_at, updated_at, deleted_at, attachments`;
const CATEGORY_COLUMNS = 'id, name, created_at, updated_at';

function attachmentsOf(json: string): Attachment[] {
  try {
    const list: unknown = JSON.parse(json);
    return Array.isArray(list) ? (list as Attachment[]) : [];
  } catch {
    return [];
  }
}

function noteOfRow(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    bodyFormat: row.body_format as BodyFormat,
    plainText: row.plain_text,
    categoryId: row.category_id,
    archived: row.archived === 1,
    pinned: row.pinned === 1,
    hidden: row.hidden === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    attachments: attachmentsOf(row.attachments),
  };
}

function categoryOfRow(row: CategoryRow): Category {
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
}

function noteEntry(row: NoteRow & SyncColumns): SyncEntry {
  return {
    kind: 'note',
    id: row.id,
    note: noteOfRow(row),
    dirty: row.dirty === 1,
    serverSeq: row.server_seq,
  };
}

function categoryEntry(row: CategoryRow & SyncColumns): SyncEntry {
  return {
    kind: 'category',
    id: row.id,
    category: categoryOfRow(row),
    dirty: row.dirty === 1,
    serverSeq: row.server_seq,
  };
}

function tombstoneEntry(row: { id: string; server_seq: number }): SyncEntry {
  return { kind: 'tombstone', id: row.id, dirty: true, serverSeq: row.server_seq };
}

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
    if (filter.hidden !== undefined) {
      where.push('hidden = ?');
      params.push(filter.hidden ? 1 : 0);
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
      `SELECT id, title, category_id, archived, pinned, hidden, updated_at, deleted_at,
              substr(plain_text, 1, ${PREVIEW_LENGTH * 4}) AS preview
         FROM notes
        WHERE ${where.join(' AND ')}`,
      params,
    );
    // Tri en JavaScript : les collations de SQLite ignorent les accents français.
    const notes = rows.map((row) => ({
      id: row.id,
      title: row.title,
      preview: previewOf(row.preview),
      categoryId: row.category_id,
      archived: row.archived === 1,
      pinned: row.pinned === 1,
      hidden: row.hidden === 1,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    }));
    return notes.sort(compareNotes(filter.view, filter.sort));
  }

  async getNote(id: string): Promise<Note | null> {
    const row = await this.db.getFirstAsync<NoteRow>(
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ?`,
      [id],
    );
    return row ? noteOfRow(row) : null;
  }

  /**
   * @param remoteSeq Absent : écriture locale, la note devient « à envoyer » et
   *   garde sa version du serveur (y compris si elle renaît après suppression).
   *   Présent : version reçue du serveur.
   */
  private async writeNote(note: Note, remoteSeq?: number): Promise<void> {
    const local = remoteSeq === undefined;
    await this.db.runAsync(
      `INSERT INTO notes (id, title, body, body_format, plain_text, search_text,
                          category_id, archived, pinned, hidden, created_at, updated_at,
                          deleted_at, attachments, dirty, server_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ${local ? '(SELECT server_seq FROM tombstones WHERE id = ?)' : '?'})
       ON CONFLICT (id) DO UPDATE SET
         title = excluded.title, body = excluded.body, body_format = excluded.body_format,
         plain_text = excluded.plain_text, search_text = excluded.search_text,
         category_id = excluded.category_id, archived = excluded.archived,
         pinned = excluded.pinned, hidden = excluded.hidden,
         created_at = excluded.created_at, updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at, attachments = excluded.attachments,
         dirty = excluded.dirty
         ${local ? '' : ', server_seq = excluded.server_seq'}`,
      [
        note.id,
        note.title,
        note.body,
        note.bodyFormat,
        note.plainText,
        searchTextOf(note),
        note.categoryId,
        note.archived ? 1 : 0,
        note.pinned ? 1 : 0,
        note.hidden ? 1 : 0,
        note.createdAt,
        note.updatedAt,
        note.deletedAt,
        JSON.stringify(note.attachments),
        local ? 1 : 0,
        local ? note.id : remoteSeq,
      ],
    );
    await this.db.runAsync('DELETE FROM tombstones WHERE id = ?', [note.id]);
    await this.db.runAsync('DELETE FROM note_blobs WHERE note_id = ?', [note.id]);
    for (const blobId of blobIdsOf(note)) {
      await this.db.runAsync('INSERT OR IGNORE INTO note_blobs (note_id, blob_id) VALUES (?, ?)', [
        note.id,
        blobId,
      ]);
    }
  }

  /** Oublie les références des notes qui n'existent plus. */
  private async pruneBlobRefs(): Promise<void> {
    await this.db.runAsync('DELETE FROM note_blobs WHERE note_id NOT IN (SELECT id FROM notes)');
  }

  private async writeCategory(category: Category, remoteSeq?: number): Promise<void> {
    const local = remoteSeq === undefined;
    await this.db.runAsync(
      `INSERT INTO categories (id, name, created_at, updated_at, dirty, server_seq)
       VALUES (?, ?, ?, ?, ?, ${local ? '(SELECT server_seq FROM tombstones WHERE id = ?)' : '?'})
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, created_at = excluded.created_at,
         updated_at = excluded.updated_at, dirty = excluded.dirty
         ${local ? '' : ', server_seq = excluded.server_seq'}`,
      [
        category.id,
        category.name,
        category.createdAt,
        category.updatedAt,
        local ? 1 : 0,
        local ? category.id : remoteSeq,
      ],
    );
    await this.db.runAsync('DELETE FROM tombstones WHERE id = ?', [category.id]);
  }

  async saveNote(note: Note): Promise<void> {
    await this.writeNote(note);
  }

  /** Supprime des lignes en gardant une trace de celles que le serveur connaît. */
  private async bury(table: 'notes' | 'categories', where: string, params: string[]) {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `INSERT OR REPLACE INTO tombstones (id, server_seq)
         SELECT id, server_seq FROM ${table} WHERE ${where} AND server_seq IS NOT NULL`,
        params,
      );
      await this.db.runAsync(`DELETE FROM ${table} WHERE ${where}`, params);
    });
  }

  async deleteNote(id: string): Promise<void> {
    await this.bury('notes', 'id = ?', [id]);
    await this.pruneBlobRefs();
  }

  async emptyTrash(hidden?: boolean): Promise<void> {
    if (hidden === undefined) await this.bury('notes', 'deleted_at IS NOT NULL', []);
    else await this.bury('notes', `deleted_at IS NOT NULL AND hidden = ${hidden ? 1 : 0}`, []);
    await this.pruneBlobRefs();
  }

  async listCategories(): Promise<Category[]> {
    const rows = await this.db.getAllAsync<CategoryRow>(
      `SELECT ${CATEGORY_COLUMNS} FROM categories`,
    );
    return rows
      .map(categoryOfRow)
      .sort((a, b) => foldText(a.name).localeCompare(foldText(b.name)));
  }

  async saveCategory(category: Category): Promise<void> {
    await this.writeCategory(category);
  }

  async deleteCategory(id: string, now: number): Promise<void> {
    await this.db.runAsync(
      'UPDATE notes SET category_id = NULL, updated_at = ?, dirty = 1 WHERE category_id = ?',
      [now, id],
    );
    await this.bury('categories', 'id = ?', [id]);
  }

  async listPending(): Promise<SyncEntry[]> {
    const categories = await this.db.getAllAsync<CategoryRow & SyncColumns>(
      `SELECT ${CATEGORY_COLUMNS}, dirty, server_seq FROM categories WHERE dirty = 1`,
    );
    const notes = await this.db.getAllAsync<NoteRow & SyncColumns>(
      `SELECT ${NOTE_COLUMNS}, dirty, server_seq FROM notes WHERE dirty = 1`,
    );
    const tombstones = await this.db.getAllAsync<{ id: string; server_seq: number }>(
      'SELECT id, server_seq FROM tombstones',
    );
    return [
      ...categories.map(categoryEntry),
      ...notes.map(noteEntry),
      ...tombstones.map(tombstoneEntry),
    ];
  }

  async getSyncEntry(id: string): Promise<SyncEntry | null> {
    const tombstone = await this.db.getFirstAsync<{ id: string; server_seq: number }>(
      'SELECT id, server_seq FROM tombstones WHERE id = ?',
      [id],
    );
    if (tombstone) return tombstoneEntry(tombstone);
    const note = await this.db.getFirstAsync<NoteRow & SyncColumns>(
      `SELECT ${NOTE_COLUMNS}, dirty, server_seq FROM notes WHERE id = ?`,
      [id],
    );
    if (note) return noteEntry(note);
    const category = await this.db.getFirstAsync<CategoryRow & SyncColumns>(
      `SELECT ${CATEGORY_COLUMNS}, dirty, server_seq FROM categories WHERE id = ?`,
      [id],
    );
    return category ? categoryEntry(category) : null;
  }

  async applyRemote(change: RemoteChange, seq: number): Promise<void> {
    if (change.kind === 'note') {
      await this.writeNote(change.note, seq);
    } else if (change.kind === 'category') {
      await this.writeCategory(change.category, seq);
    } else {
      await this.db.runAsync('DELETE FROM notes WHERE id = ?', [change.id]);
      await this.db.runAsync('DELETE FROM categories WHERE id = ?', [change.id]);
      await this.db.runAsync('DELETE FROM tombstones WHERE id = ?', [change.id]);
      await this.pruneBlobRefs();
    }
  }

  async setServerSeq(id: string, seq: number): Promise<void> {
    for (const table of ['notes', 'categories', 'tombstones']) {
      await this.db.runAsync(`UPDATE ${table} SET server_seq = ? WHERE id = ?`, [seq, id]);
    }
  }

  async markPushed(entry: SyncEntry, seq: number): Promise<void> {
    if (entry.kind === 'tombstone') {
      await this.db.runAsync('DELETE FROM tombstones WHERE id = ? AND server_seq = ?', [
        entry.id,
        entry.serverSeq,
      ]);
      return;
    }
    const [table, updatedAt] =
      entry.kind === 'note'
        ? ['notes', entry.note.updatedAt]
        : ['categories', entry.category.updatedAt];
    const result = await this.db.runAsync(
      `UPDATE ${table}
          SET server_seq = ?, dirty = CASE WHEN updated_at = ? THEN 0 ELSE 1 END
        WHERE id = ?`,
      [seq, updatedAt, entry.id],
    );
    if (result.changes === 0) {
      // Supprimé pendant l'envoi : le serveur doit encore l'apprendre.
      await this.db.runAsync('INSERT OR REPLACE INTO tombstones (id, server_seq) VALUES (?, ?)', [
        entry.id,
        seq,
      ]);
    }
  }

  async putBlob(id: string, data: Uint8Array): Promise<void> {
    await this.db.runAsync(
      'INSERT OR IGNORE INTO blobs (id, data, size, uploaded, created_at) VALUES (?, ?, ?, 0, ?)',
      [id, data, data.length, Date.now()],
    );
  }

  async missingBlobs(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.getAllAsync<{ id: string }>(
      `SELECT id FROM blobs WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ids,
    );
    const present = new Set(rows.map((row) => row.id));
    return ids.filter((id) => !present.has(id));
  }

  async getBlob(id: string): Promise<Uint8Array | null> {
    const row = await this.db.getFirstAsync<{ data: Uint8Array }>(
      'SELECT data FROM blobs WHERE id = ?',
      [id],
    );
    return row ? new Uint8Array(row.data) : null;
  }

  async listBlobs(): Promise<BlobState[]> {
    const rows = await this.db.getAllAsync<{
      id: string;
      has_data: number;
      uploaded: number;
      size: number;
      created_at: number;
      referenced: number;
    }>(
      `SELECT id, 1 AS has_data, uploaded, size, created_at,
              EXISTS (SELECT 1 FROM note_blobs WHERE blob_id = blobs.id) AS referenced
         FROM blobs
        UNION ALL
       SELECT DISTINCT blob_id, 0, 0, 0, 0, 1
         FROM note_blobs
        WHERE blob_id NOT IN (SELECT id FROM blobs)`,
    );
    return rows.map((row) => ({
      id: row.id,
      hasData: row.has_data === 1,
      uploaded: row.uploaded === 1,
      referenced: row.referenced === 1,
      size: row.size,
      createdAt: row.created_at,
    }));
  }

  async storeRemoteBlob(id: string, data: Uint8Array): Promise<void> {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO blobs (id, data, size, uploaded, created_at) VALUES (?, ?, ?, 1, ?)',
      [id, data, data.length, Date.now()],
    );
  }

  async setBlobUploaded(id: string, uploaded: boolean): Promise<void> {
    await this.db.runAsync('UPDATE blobs SET uploaded = ? WHERE id = ?', [uploaded ? 1 : 0, id]);
  }

  async deleteBlob(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM blobs WHERE id = ?', [id]);
  }

  async getSyncValue(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM sync_state WHERE key = ?',
      [key],
    );
    return row?.value ?? null;
  }

  async setSyncValue(key: string, value: string): Promise<void> {
    await this.db.runAsync('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [
      key,
      value,
    ]);
  }

  async resetSync(): Promise<void> {
    await this.db.execAsync(
      `UPDATE notes SET dirty = 1, server_seq = NULL;
       UPDATE categories SET dirty = 1, server_seq = NULL;
       UPDATE blobs SET uploaded = 0;
       DELETE FROM tombstones;
       DELETE FROM sync_state;`,
    );
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
