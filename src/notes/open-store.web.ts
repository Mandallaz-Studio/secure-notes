import type { VaultKeys } from '@/crypto/keys';
import { MemoryNoteStore } from '@/notes/memory-store';
import type { NoteStore } from '@/notes/types';

/**
 * Sur le web, rien n'est écrit sur disque : les notes vivent en mémoire et
 * disparaissent au rechargement, comme la clé maîtresse.
 */
export async function openNoteStore(_keys: VaultKeys): Promise<NoteStore> {
  return new MemoryNoteStore();
}

export async function wipeNoteStore(_accountId: string): Promise<void> {}
