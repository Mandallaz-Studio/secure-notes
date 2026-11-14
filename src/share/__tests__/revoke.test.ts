import { cryptoReady, generateKey, toBase64 } from '@/crypto/aead';
import { MemoryNoteStore } from '@/notes/memory-store';
import { createNote, newId, restored, trashed, withTitle } from '@/notes/model';
import { sealShareMeta } from '@/share/codec';
import { revokeTrashedShares, type ShareRemote } from '@/share/revoke';
import type { RemoteShare } from '@/sync/supabase';

beforeAll(async () => {
  await cryptoReady();
});

class FakeShares implements ShareRemote {
  shares: RemoteShare[] = [];
  lists = 0;

  add(noteId: string, wrapKey: Uint8Array): string {
    const id = newId();
    const meta = sealShareMeta(id, { noteId, key: toBase64(generateKey()), title: '' }, wrapKey);
    this.shares.push({ id, meta, createdAt: 0 });
    return id;
  }

  async listShares() {
    this.lists += 1;
    return [...this.shares];
  }

  async deleteShare(id: string) {
    this.shares = this.shares.filter((share) => share.id !== id);
  }
}

describe('révocation des liens des notes mises à la corbeille', () => {
  it('révoque les liens d’une note à la corbeille, pas ceux des autres', async () => {
    const store = new MemoryNoteStore();
    const wrapKey = generateKey();
    const remote = new FakeShares();
    const kept = withTitle(createNote(1), 'gardée', 1);
    const thrown = withTitle(createNote(1), 'jetée', 1);
    await store.saveNote(kept);
    await store.saveNote(trashed(thrown, 2));
    const keptShare = remote.add(kept.id, wrapKey);
    remote.add(thrown.id, wrapKey);
    remote.add(thrown.id, wrapKey);
    // Lien d'une note pas encore arrivée sur cet appareil : on n'y touche pas.
    const unknownShare = remote.add(newId(), wrapKey);
    // Ligne d'un autre compte : illisible, ignorée.
    const foreignShare = remote.add(thrown.id, generateKey());

    const checked = new Set<string>();
    expect(await revokeTrashedShares(store, remote, wrapKey, checked)).toBe(2);
    expect(remote.shares.map((share) => share.id).sort()).toEqual(
      [keptShare, unknownShare, foreignShare].sort(),
    );

    // Rien de nouveau dans la corbeille : le serveur n'est pas interrogé.
    await revokeTrashedShares(store, remote, wrapKey, checked);
    expect(remote.lists).toBe(1);

    // Restaurée, partagée, puis remise à la corbeille : vérifiée à nouveau.
    await store.saveNote(restored(trashed(thrown, 2), 3));
    remote.add(thrown.id, wrapKey);
    await store.saveNote(trashed(thrown, 4));
    expect(await revokeTrashedShares(store, remote, wrapKey, checked)).toBe(1);
    expect(remote.lists).toBe(2);
  });

  it('reconnaît une note supprimée définitivement tant que la suppression n’est pas envoyée', async () => {
    const store = new MemoryNoteStore();
    const wrapKey = generateKey();
    const remote = new FakeShares();
    const note = withTitle(createNote(1), 'supprimée', 1);
    await store.saveNote(note);
    // Déjà connue du serveur : sa suppression laisse une trace à envoyer.
    await store.markPushed((await store.getSyncEntry(note.id))!, 1);
    await store.deleteNote(note.id);
    remote.add(note.id, wrapKey);

    expect(await revokeTrashedShares(store, remote, wrapKey, new Set())).toBe(1);
    expect(remote.shares).toEqual([]);
  });
});
