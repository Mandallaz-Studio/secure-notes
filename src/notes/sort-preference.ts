import { useState } from 'react';

import { DEFAULT_SORT } from '@/notes/model';
import type { NoteSort } from '@/notes/types';
import { getPref, setPref } from '@/storage/prefs';

const PREF_SORT = 'note-sort';

const SORTS: readonly NoteSort[] = ['title-asc', 'title-desc', 'updated-desc', 'updated-asc'];

function parseSort(value: string | null): NoteSort {
  return SORTS.find((sort) => sort === value) ?? DEFAULT_SORT;
}

/** Ordre choisi pour les listes de notes, conservé d'une session à l'autre. */
export function useNoteSort(): [NoteSort, (sort: NoteSort) => void] {
  const [sort, setSortState] = useState<NoteSort>(() => parseSort(getPref(PREF_SORT)));
  const setSort = (next: NoteSort) => {
    setSortState(next);
    setPref(PREF_SORT, next);
  };
  return [sort, setSort];
}
