import { cryptoReady } from '@/crypto/aead';
import { createNote } from '@/notes/model';
import { setPendingNoteSink, submitNote } from '@/notes/pending-notes';
import type { Note } from '@/notes/types';

beforeAll(async () => {
  await cryptoReady();
});

describe('notes en attente', () => {
  afterEach(() => setPendingNoteSink(null));

  it('enregistre aussitôt quand la base est ouverte', async () => {
    const saved: Note[] = [];
    await setPendingNoteSink(async (note) => void saved.push(note));
    const note = createNote(1);
    expect(await submitNote(note)).toBe(true);
    expect(saved).toEqual([note]);
  });

  it('garde la note tant que la base est fermée, puis l’enregistre à la réouverture', async () => {
    const note = createNote(1);
    expect(await submitNote(note)).toBe(false);
    const saved: Note[] = [];
    await setPendingNoteSink(async (pendingNote) => void saved.push(pendingNote));
    expect(saved).toEqual([note]);
    // Elle n'est enregistrée qu'une fois.
    await setPendingNoteSink(async (pendingNote) => void saved.push(pendingNote));
    expect(saved).toEqual([note]);
  });

  it('garde la note si l’écriture échoue (base fermée entre-temps)', async () => {
    await setPendingNoteSink(async () => {
      throw new Error('base fermée');
    });
    const note = createNote(1);
    expect(await submitNote(note)).toBe(false);
    const saved: Note[] = [];
    await setPendingNoteSink(async (pendingNote) => void saved.push(pendingNote));
    expect(saved).toEqual([note]);
  });
});
