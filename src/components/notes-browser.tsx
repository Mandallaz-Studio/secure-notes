import { Link, useRouter } from 'expo-router';
import {
  Archive,
  ArchiveRestore,
  FileText,
  Lock,
  Search,
  Settings2,
  Tag,
  Trash2,
  X,
} from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { CategoryPicker } from '@/components/category-picker';
import { Chip } from '@/components/chip';
import { confirmDestructive } from '@/components/confirm';
import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { IconButton } from '@/components/icon-button';
import { NoteRow } from '@/components/note-row';
import { SegmentedControl } from '@/components/segmented-control';
import { SearchField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteNotes, updateNotes } from '@/notes/bulk';
import { formatNoteDate } from '@/notes/format';
import { restored, trashed, withArchived, withCategory } from '@/notes/model';
import { useCategories, useNoteList, useNotes } from '@/notes/notes-context';
import type { Note, NoteSummary, NoteView } from '@/notes/types';

const VIEWS: { value: NoteView; label: string }[] = [
  { value: 'active', label: 'Notes' },
  { value: 'archived', label: 'Archives' },
  { value: 'trash', label: 'Corbeille' },
];

const SEARCH_PLACEHOLDER: Record<NoteView, string> = {
  active: 'Rechercher dans les notes',
  archived: 'Rechercher dans les archives',
  trash: 'Rechercher dans la corbeille',
};

function EmptyList({ view, filtered, hidden }: { view: NoteView; filtered: boolean; hidden: boolean }) {
  if (filtered) return <EmptyState icon={Search} title="Aucune note ne correspond" />;
  switch (view) {
    case 'active':
      return hidden ? (
        <EmptyState
          icon={Lock}
          title="Le dossier privé est vide"
          message="Ses notes n’apparaissent ni dans la liste ni dans la recherche ordinaires. Créez-en une ici, ou déplacez-y une note depuis son en-tête."
        />
      ) : (
        <EmptyState
          icon={FileText}
          title="Aucune note"
          message="Vos notes sont chiffrées avant d’être enregistrées. Touchez « Nouvelle note » pour commencer."
        />
      );
    case 'archived':
      return <EmptyState icon={Archive} title="Aucune note archivée" />;
    case 'trash':
      return <EmptyState icon={Trash2} title="La corbeille est vide" />;
  }
}

type NotesBrowserProps = {
  /** Notes du dossier privé (`true`) ou toutes les autres. */
  hidden: boolean;
  /** Affiché au-dessus de la recherche. */
  header?: ReactNode;
};

/**
 * Recherche, vues (notes, archives, corbeille), catégories et liste des notes,
 * avec le bouton « Nouvelle note ». Sert à l'accueil et au dossier privé, qui
 * ne voient jamais les notes l'un de l'autre.
 */
export function NotesBrowser({ hidden, header }: NotesBrowserProps) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { store, error, invalidate } = useNotes();
  const categories = useCategories();
  const [view, setView] = useState<NoteView>('active');
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');

  // Une catégorie supprimée entre-temps ne filtre plus rien.
  const activeCategoryId = categories.some((c) => c.id === categoryId) ? categoryId : undefined;
  const notes = useNoteList({ view, categoryId: activeCategoryId, search, hidden });
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const filtered = search.trim() !== '' || activeCategoryId !== undefined;

  // --- Sélection -----------------------------------------------------------
  /** `null` : hors du mode sélection. */
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const selecting = selection !== null;
  // Seules les notes affichées comptent : une recherche ou un filtre peut en masquer.
  const selectedIds = (notes ?? []).filter((note) => selection?.has(note.id)).map((n) => n.id);
  const allSelected = notes !== null && notes.length > 0 && selectedIds.length === notes.length;

  const endSelection = () => {
    setSelection(null);
    setPicking(false);
  };

  const toggle = (id: string) => {
    const next = new Set(selection ?? []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // La dernière note désélectionnée fait quitter le mode sélection.
    setSelection(next.size > 0 ? next : null);
  };

  const toggleAll = () => {
    if (allSelected) endSelection();
    else setSelection(new Set((notes ?? []).map((note) => note.id)));
  };

  const changeView = (next: NoteView) => {
    endSelection();
    setView(next);
  };

  // Le bouton retour d'Android quitte d'abord le mode sélection.
  useEffect(() => {
    if (!selecting) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      endSelection();
      return true;
    });
    return () => subscription.remove();
  }, [selecting]);

  /** Applique une action aux notes sélectionnées, puis quitte le mode sélection. */
  const runBulk = async (action: (ids: string[]) => Promise<unknown>) => {
    if (!store || busy || selectedIds.length === 0) return;
    setBusy(true);
    setBulkError(null);
    try {
      await action(selectedIds);
      endSelection();
    } catch (cause) {
      setBulkError(`L'opération n'a pas abouti pour toutes les notes : ${String(cause)}`);
    } finally {
      // Une partie des notes a pu changer même en cas d'échec.
      invalidate();
      setBusy(false);
    }
  };

  const changeAll = (change: (note: Note, now: number) => Note) =>
    runBulk((ids) => updateNotes(store!, ids, change, Date.now()));

  const deleteSelected = async () => {
    const count = selectedIds.length;
    const confirmed = await confirmDestructive({
      title: `Supprimer définitivement ${count} note(s) ?`,
      message: 'Elles ne pourront pas être récupérées.',
      confirmLabel: 'Supprimer',
    });
    if (confirmed) await runBulk((ids) => deleteNotes(store!, ids));
  };

  const emptyTrash = async () => {
    const confirmed = await confirmDestructive({
      title: 'Vider la corbeille ?',
      message: hidden
        ? 'Les notes de la corbeille du dossier privé seront définitivement supprimées.'
        : 'Les notes de la corbeille seront définitivement supprimées.',
      confirmLabel: 'Vider',
    });
    if (confirmed && store) {
      await store.emptyTrash(hidden);
      invalidate();
    }
  };

  const renderNote = ({ item }: { item: NoteSummary }) => (
    <NoteRow
      title={item.title}
      preview={item.preview}
      date={formatNoteDate(item.updatedAt)}
      category={item.categoryId ? categoryNames.get(item.categoryId) : undefined}
      pinned={item.pinned && view !== 'trash'}
      selecting={selecting}
      selected={selection?.has(item.id) ?? false}
      onPress={() =>
        selecting
          ? toggle(item.id)
          : router.push({ pathname: '/note/[id]', params: { id: item.id } })
      }
      onLongPress={() => toggle(item.id)}
    />
  );

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        {header}
        <View style={styles.controls}>
          <SearchField
            placeholder={SEARCH_PLACEHOLDER[view]}
            value={search}
            onChangeText={setSearch}
            clearButtonMode="never"
          />
          <SegmentedControl options={VIEWS} value={view} onChange={changeView} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.chipScroll}>
            <View style={styles.chips}>
              <Chip
                label="Toutes"
                selected={activeCategoryId === undefined}
                onPress={() => setCategoryId(undefined)}
              />
              {categories.map((category) => (
                <Chip
                  key={category.id}
                  label={category.name}
                  selected={activeCategoryId === category.id}
                  onPress={() => setCategoryId(category.id)}
                />
              ))}
              <Link href="/categories" asChild>
                <Chip label="Gérer" accessibilityLabel="Gérer les catégories" icon={Settings2} variant="action" />
              </Link>
            </View>
          </ScrollView>
          {view === 'trash' && notes !== null && notes.length > 0 && !selecting && (
            <Button label="Vider la corbeille" icon={Trash2} variant="danger" onPress={emptyTrash} />
          )}
          {selecting && (
            <View style={[styles.selectionBar, { backgroundColor: theme.accentSubtle }]}>
              <IconButton icon={X} label="Quitter la sélection" onPress={endSelection} />
              <ThemedText type="headline" style={styles.flex} accessibilityLiveRegion="polite">
                {selectedIds.length} sélectionnée{selectedIds.length > 1 ? 's' : ''}
              </ThemedText>
              <Button
                size="sm"
                variant="ghost"
                label={allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                onPress={toggleAll}
              />
            </View>
          )}
          {bulkError && (
            <ThemedText themeColor="danger" type="callout">
              {bulkError}
            </ThemedText>
          )}
        </View>

        {error ? (
          <ThemedText themeColor="danger" style={styles.message}>
            {error}
          </ThemedText>
        ) : (
          <FlatList
            data={notes ?? []}
            keyExtractor={(note) => note.id}
            renderItem={renderNote}
            keyboardShouldPersistTaps="handled"
            style={[styles.list, { borderColor: theme.border }]}
            contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.six + Spacing.four }}
            ListEmptyComponent={
              notes === null ? undefined : (
                <EmptyList view={view} filtered={filtered} hidden={hidden} />
              )
            }
          />
        )}
      </View>

      {selecting && (
        <View
          style={[
            styles.actions,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              paddingBottom: insets.bottom + Spacing.two,
            },
          ]}>
          {view === 'trash' ? (
            <>
              <Button
                size="sm"
                icon={ArchiveRestore}
                label="Restaurer"
                disabled={busy}
                onPress={() => void changeAll(restored)}
              />
              <Button
                size="sm"
                variant="danger"
                icon={Trash2}
                label="Supprimer"
                disabled={busy}
                onPress={() => void deleteSelected()}
              />
            </>
          ) : (
            <>
              <Button
                size="sm"
                icon={view === 'archived' ? ArchiveRestore : Archive}
                label={view === 'archived' ? 'Désarchiver' : 'Archiver'}
                disabled={busy}
                onPress={() =>
                  void changeAll((note, now) => withArchived(note, view !== 'archived', now))
                }
              />
              <Button
                size="sm"
                icon={Tag}
                label="Catégorie"
                disabled={busy}
                onPress={() => setPicking(true)}
              />
              <Button
                size="sm"
                variant="danger"
                icon={Trash2}
                label="Corbeille"
                disabled={busy}
                onPress={() => void changeAll(trashed)}
              />
            </>
          )}
        </View>
      )}

      <CategoryPicker
        visible={picking}
        title={`Catégorie de ${selectedIds.length} note${selectedIds.length > 1 ? 's' : ''}`}
        categories={categories}
        onClose={() => setPicking(false)}
        onPick={(categoryId) => {
          setPicking(false);
          void changeAll((note, now) => withCategory(note, categoryId, now));
        }}
      />

      {view === 'active' && store && !selecting && (
        <View style={[styles.fab, { bottom: insets.bottom + Spacing.three }]}>
          <Fab
            label="Nouvelle note"
            onPress={() =>
              router.push({
                pathname: '/note/[id]',
                params: {
                  id: 'new',
                  category: activeCategoryId ?? '',
                  ...(hidden ? { hidden: '1' } : {}),
                },
              })
            }
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', alignItems: 'center' },
  inner: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  controls: { padding: Spacing.three, gap: 12 },
  // Sans cela, la rangée défilante s'étire en hauteur.
  chipScroll: { flexGrow: 0 },
  chips: { flexDirection: 'row', gap: Spacing.two },
  list: { borderTopWidth: StyleSheet.hairlineWidth },
  message: { textAlign: 'center', padding: Spacing.four },
  fab: { position: 'absolute', right: Spacing.three },
  flex: { flex: 1 },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingRight: Spacing.one,
    borderRadius: Radius.md,
  },
  actions: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    maxWidth: MaxContentWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
