import type { VaultKeys } from '@/crypto/keys';
import { deleteNoteDatabase, SqliteNoteStore } from '@/notes/sqlite-store';
import type { NoteStore } from '@/notes/types';

/** Ouvre la base chiffrée du compte. */
export function openNoteStore(keys: VaultKeys): Promise<NoteStore> {
  return SqliteNoteStore.open(keys.accountId, keys.databaseKey);
}

/** Efface les notes du compte de cet appareil. */
export function wipeNoteStore(accountId: string): Promise<void> {
  return deleteNoteDatabase(accountId);
}
