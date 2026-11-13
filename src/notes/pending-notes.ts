import type { Note } from '@/notes/types';

/**
 * Notes créées hors de l'éditeur (import) et à enregistrer dans la base.
 *
 * Elles passent par ici plutôt que par la base directement, car le coffre
 * peut se verrouiller pendant le choix du fichier (plus de 30 secondes hors
 * de l'app) : la base est alors fermée. La note attend en mémoire le prochain
 * déverrouillage au lieu d'être perdue.
 */
type Sink = (note: Note) => Promise<void>;

let pending: Note[] = [];
let sink: Sink | null = null;

async function flush(): Promise<void> {
  while (sink && pending.length > 0) {
    const note = pending[0];
    await sink(note);
    // Retirée seulement une fois enregistrée : un échec la laisse en attente.
    pending = pending.filter((other) => other !== note);
  }
}

/**
 * Branche la base ouverte et y enregistre les notes en attente.
 * `null` : la base est fermée.
 */
export async function setPendingNoteSink(next: Sink | null): Promise<void> {
  sink = next;
  await flush();
}

/**
 * Confie une note à enregistrer. Renvoie `true` si elle l'a été aussitôt,
 * `false` si elle attend la réouverture de la base.
 */
export async function submitNote(note: Note): Promise<boolean> {
  pending.push(note);
  try {
    await flush();
  } catch {
    // Base fermée pendant l'écriture : la note reste en attente.
  }
  return !pending.includes(note);
}
