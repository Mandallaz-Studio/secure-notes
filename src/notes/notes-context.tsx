import { createContext, use, useEffect, useState, type ReactNode } from 'react';

import { setPendingNoteSink } from '@/notes/pending-notes';
import { acquireNoteStore, releaseNoteStore } from '@/notes/store-manager';
import type { Category, NoteFilter, NoteStore, NoteSummary } from '@/notes/types';
import { useVault } from '@/vault/vault-context';

type NotesContextValue = {
  /** `null` tant que la base n'est pas ouverte. */
  store: NoteStore | null;
  /** Message si la base n'a pas pu être ouverte. */
  error: string | null;
  /** Change à chaque modification ; sert à recharger les listes. */
  revision: number;
  /** À appeler après toute écriture. */
  invalidate: () => void;
};

const NotesContext = createContext<NotesContextValue | null>(null);

/** Ouvre la base de notes tant que le coffre est déverrouillé. */
export function NotesProvider({ children }: { children: ReactNode }) {
  const { keys } = useVault();
  const [store, setStore] = useState<NoteStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!keys) return;
    let cancelled = false;
    acquireNoteStore(keys)
      .then(async (opened) => {
        if (cancelled) return;
        // Enregistre aussi les notes importées pendant que le coffre se verrouillait.
        await setPendingNoteSink(async (note) => {
          await opened.saveNote(note);
          setRevision((value) => value + 1);
        });
        if (!cancelled) setStore(opened);
      })
      .catch((cause) => {
        if (!cancelled) setError(`La base de notes n'a pas pu être ouverte : ${String(cause)}`);
      });
    return () => {
      cancelled = true;
      void setPendingNoteSink(null);
      setStore(null);
      setError(null);
      void releaseNoteStore();
    };
  }, [keys]);

  return (
    <NotesContext
      value={{ store, error, revision, invalidate: () => setRevision((value) => value + 1) }}>
      {children}
    </NotesContext>
  );
}

export function useNotes(): NotesContextValue {
  const value = use(NotesContext);
  if (!value) {
    throw new Error('useNotes doit être utilisé sous NotesProvider');
  }
  return value;
}

/** Liste des notes correspondant au filtre, rechargée après chaque écriture. */
export function useNoteList(filter: NoteFilter & { hidden: boolean }): NoteSummary[] | null {
  const { store, revision } = useNotes();
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const { view, sort, categoryId, search, hidden } = filter;

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    store.listNotes({ view, sort, categoryId, search, hidden }).then(
      (list) => {
        if (!cancelled) setNotes(list);
      },
      () => {
        // Base fermée entre-temps (verrouillage) : la liste sera rechargée.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store, revision, view, sort, categoryId, search, hidden]);

  return store ? notes : null;
}

export function useCategories(): Category[] {
  const { store, revision } = useNotes();
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    store.listCategories().then(
      (list) => {
        if (!cancelled) setCategories(list);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [store, revision]);

  return categories;
}
