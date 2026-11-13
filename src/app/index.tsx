import { Link, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { confirmDestructive } from '@/components/confirm';
import { TextField } from '@/components/text-field';
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

function emptyMessage(view: NoteView, filtered: boolean): string {
  if (filtered) return 'Aucune note ne correspond.';
  switch (view) {
    case 'active':
      return 'Aucune note. Touchez « Nouvelle note » pour commencer.';
    case 'archived':
      return 'Aucune note archivée.';
    case 'trash':
      return 'La corbeille est vide.';
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
    // Pas de <Link asChild> ici : sur Android, il fait perdre son style à la ligne.
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title.trim() || 'Sans titre'}
      onPress={() => router.push({ pathname: '/note/[id]', params: { id: item.id } })}
      style={({ pressed }) => [
        styles.note,
        { borderColor: theme.border, opacity: pressed ? 0.6 : 1 },
      ]}>
      <View style={styles.noteHeader}>
        <ThemedText numberOfLines={1} style={styles.noteTitle}>
          {item.title.trim() || 'Sans titre'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatNoteDate(item.updatedAt)}
        </ThemedText>
      </View>
      {item.preview !== '' && (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {item.preview}
        </ThemedText>
      )}
      {item.categoryId && categoryNames.has(item.categoryId) && (
        <ThemedText type="small" style={{ color: theme.tint }}>
          {categoryNames.get(item.categoryId)}
        </ThemedText>
      )}
    </Pressable>
  );

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" accessibilityRole="button" accessibilityLabel="Réglages">
              <ThemedText style={{ color: theme.tint }}>Réglages</ThemedText>
            </Link>
          ),
        }}
      />
      <View style={styles.inner}>
        <View style={styles.controls}>
          <View style={styles.row}>
            {VIEWS.map((option) => (
              <View key={option.value} style={styles.flex}>
                <Button
                  label={option.label}
                  selected={view === option.value}
                  onPress={() => setView(option.value)}
                />
              </View>
            ))}
          </View>
          <TextField
            accessibilityLabel="Rechercher"
            placeholder="Rechercher"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
                <Chip label="Gérer les catégories" />
              </Link>
            </View>
          </ScrollView>
          {view === 'trash' && notes !== null && notes.length > 0 && (
            <Button label="Vider la corbeille" variant="danger" onPress={emptyTrash} />
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
            contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.six + Spacing.four }}
            ListEmptyComponent={
              notes === null ? undefined : (
                <ThemedText themeColor="textSecondary" style={styles.message}>
                  {emptyMessage(view, filtered)}
                </ThemedText>
              )
            }
          />
        )}
      </View>

      {view === 'active' && store && (
        <View style={[styles.fab, { bottom: insets.bottom + Spacing.three }]}>
          <Button
            label="Nouvelle note"
            variant="primary"
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
  controls: { padding: Spacing.three, gap: Spacing.two + Spacing.one },
  row: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', gap: Spacing.two },
  note: {
    paddingVertical: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.half,
  },
  noteHeader: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  noteTitle: { flex: 1, fontWeight: 600 },
  message: { textAlign: 'center', padding: Spacing.four },
  fab: { position: 'absolute', right: Spacing.three },
});
