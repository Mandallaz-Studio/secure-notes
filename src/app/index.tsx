import { Link, useRouter } from 'expo-router';
import { Archive, FileText, Search, Settings, Settings2, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { confirmDestructive } from '@/components/confirm';
import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { IconButton } from '@/components/icon-button';
import { NoteRow } from '@/components/note-row';
import { SegmentedControl } from '@/components/segmented-control';
import { SyncStatus } from '@/components/sync-status';
import { SearchField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatNoteDate } from '@/notes/format';
import { useCategories, useNoteList, useNotes } from '@/notes/notes-context';
import type { NoteSummary, NoteView } from '@/notes/types';

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

function EmptyList({ view, filtered }: { view: NoteView; filtered: boolean }) {
  if (filtered) return <EmptyState icon={Search} title="Aucune note ne correspond" />;
  switch (view) {
    case 'active':
      return (
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

export default function NotesScreen() {
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
  const notes = useNoteList({ view, categoryId: activeCategoryId, search });
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const filtered = search.trim() !== '' || activeCategoryId !== undefined;

  const emptyTrash = async () => {
    const confirmed = await confirmDestructive({
      title: 'Vider la corbeille ?',
      message: 'Les notes de la corbeille seront définitivement supprimées.',
      confirmLabel: 'Vider',
    });
    if (confirmed && store) {
      await store.emptyTrash();
      invalidate();
    }
  };

  const renderNote = ({ item }: { item: NoteSummary }) => (
    <NoteRow
      title={item.title}
      preview={item.preview}
      date={formatNoteDate(item.updatedAt)}
      category={item.categoryId ? categoryNames.get(item.categoryId) : undefined}
      onPress={() => router.push({ pathname: '/note/[id]', params: { id: item.id } })}
    />
  );

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <ThemedText type="display" accessibilityRole="header">
              Notes
            </ThemedText>
            <Link href="/settings" asChild>
              <IconButton icon={Settings} label="Réglages" />
            </Link>
          </View>
          <SyncStatus />
        </View>
        <View style={styles.controls}>
          <SearchField
            placeholder={SEARCH_PLACEHOLDER[view]}
            value={search}
            onChangeText={setSearch}
            clearButtonMode="never"
          />
          <SegmentedControl options={VIEWS} value={view} onChange={setView} />
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
          {view === 'trash' && notes !== null && notes.length > 0 && (
            <Button label="Vider la corbeille" icon={Trash2} variant="danger" onPress={emptyTrash} />
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
              notes === null ? undefined : <EmptyList view={view} filtered={filtered} />
            }
          />
        )}
      </View>

      {view === 'active' && store && (
        <View style={[styles.fab, { bottom: insets.bottom + Spacing.three }]}>
          <Fab
            label="Nouvelle note"
            onPress={() =>
              router.push({
                pathname: '/note/[id]',
                params: { id: 'new', category: activeCategoryId ?? '' },
              })
            }
          />
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  inner: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, gap: Spacing.half },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginRight: -Spacing.two },
  controls: { padding: Spacing.three, gap: 12 },
  // Sans cela, la rangée défilante s'étire en hauteur.
  chipScroll: { flexGrow: 0 },
  chips: { flexDirection: 'row', gap: Spacing.two },
  list: { borderTopWidth: StyleSheet.hairlineWidth },
  message: { textAlign: 'center', padding: Spacing.four },
  fab: { position: 'absolute', right: Spacing.three },
});
