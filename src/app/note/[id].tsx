import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { confirmDestructive } from '@/components/confirm';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createNote,
  isBlank,
  restored,
  trashed,
  withArchived,
  withCategory,
  withText,
} from '@/notes/model';
import { useCategories, useNotes } from '@/notes/notes-context';
import type { Note, NoteStore } from '@/notes/types';

/** Délai entre la dernière frappe et l'enregistrement. */
const SAVE_DELAY_MS = 400;

export default function NoteScreen() {
  const { id, category } = useLocalSearchParams<{ id: string; category?: string }>();
  const { store, invalidate } = useNotes();
  const isNew = id === 'new';
  const [note, setNote] = useState<Note | null>(() =>
    isNew ? createNote(Date.now(), category || null) : null,
  );
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!store || isNew) return;
    let cancelled = false;
    store.getNote(id).then((found) => {
      if (cancelled) return;
      if (found) setNote(found);
      else setMissing(true);
    });
    return () => {
      cancelled = true;
    };
  }, [store, id, isNew]);

  if (missing) {
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={{ title: '' }} />
        <ThemedText themeColor="textSecondary">Cette note n&apos;existe plus.</ThemedText>
      </ThemedView>
    );
  }
  if (!note || !store) {
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={{ title: '' }} />
      </ThemedView>
    );
  }
  return <NoteEditor initial={note} isNew={isNew} store={store} onChanged={invalidate} />;
}

type NoteEditorProps = {
  initial: Note;
  /** La note n'a encore jamais été enregistrée. */
  isNew: boolean;
  store: NoteStore;
  /** Appelé après chaque écriture, pour rafraîchir les listes. */
  onChanged: () => void;
};

function NoteEditor({ initial, isNew, store, onChanged }: NoteEditorProps) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const categories = useCategories();
  const [note, setNote] = useState(initial);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Dernier état connu et état déjà écrit, pour enregistrer à la fermeture de
  // l'écran sans dépendre d'un rendu.
  const latest = useRef(initial);
  const persisted = useRef<Note | null>(isNew ? null : initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inTrash = note.deletedAt !== null;

  const flush = async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const current = latest.current;
    if (persisted.current === current) return;
    try {
      if (isBlank(current)) {
        // Une note vide n'est pas conservée.
        if (persisted.current) await store.deleteNote(current.id);
        persisted.current = null;
      } else {
        await store.saveNote(current);
        persisted.current = current;
      }
      onChanged();
    } catch (cause) {
      setSaveError(`La note n'a pas pu être enregistrée : ${String(cause)}`);
    }
  };

  const update = (next: Note, immediate = false) => {
    latest.current = next;
    setNote(next);
    setSaveError(null);
    if (timer.current) clearTimeout(timer.current);
    if (immediate) {
      return flush();
    }
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    return Promise.resolve();
  };

  // Enregistre ce qui reste en attente quand l'écran se ferme.
  useEffect(() => {
    return () => {
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uniquement à la fermeture
  }, []);

  const leaveAfter = async (next: Note) => {
    await update(next, true);
    router.back();
  };

  const deleteForever = async () => {
    const confirmed = await confirmDestructive({
      title: 'Supprimer définitivement ?',
      message: 'Cette note ne pourra pas être récupérée.',
      confirmLabel: 'Supprimer',
    });
    if (!confirmed) return;
    if (timer.current) clearTimeout(timer.current);
    await store.deleteNote(note.id);
    // Empêche l'enregistrement de fermeture de recréer la note.
    persisted.current = latest.current;
    onChanged();
    router.back();
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: inTrash ? 'Corbeille' : note.archived ? 'Archive' : '' }} />
      <KeyboardAvoidingView
        style={styles.inner}
        // Android est bord à bord : sans `behavior`, la vue reste sous le clavier.
        behavior="padding"
        keyboardVerticalOffset={headerHeight}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic">
          <TextInput
            accessibilityLabel="Titre"
            placeholder="Titre"
            placeholderTextColor={theme.textSecondary}
            value={note.title}
            editable={!inTrash}
            onChangeText={(title) => void update(withText(note, title, note.plainText, Date.now()))}
            style={[styles.title, { color: theme.text }]}
          />
          {!inTrash && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              <View style={styles.chips}>
                <Chip
                  label="Sans catégorie"
                  selected={note.categoryId === null}
                  onPress={() => void update(withCategory(note, null, Date.now()))}
                />
                {categories.map((category) => (
                  <Chip
                    key={category.id}
                    label={category.name}
                    selected={note.categoryId === category.id}
                    onPress={() => void update(withCategory(note, category.id, Date.now()))}
                  />
                ))}
                <Link href="/categories" asChild>
                  <Chip label="Gérer les catégories" />
                </Link>
              </View>
            </ScrollView>
          )}
          <TextInput
            accessibilityLabel="Contenu de la note"
            placeholder="Écrivez ici…"
            placeholderTextColor={theme.textSecondary}
            value={note.plainText}
            editable={!inTrash}
            multiline
            scrollEnabled={false}
            textAlignVertical="top"
            onChangeText={(text) => void update(withText(note, note.title, text, Date.now()))}
            style={[styles.body, { color: theme.text }]}
          />
        </ScrollView>

        {saveError && (
          <ThemedText themeColor="danger" style={styles.error}>
            {saveError}
          </ThemedText>
        )}
        <View
          style={[
            styles.actions,
            { borderColor: theme.border, paddingBottom: insets.bottom + Spacing.two },
          ]}>
          {inTrash ? (
            <>
              <View style={styles.flex}>
                <Button
                  label="Restaurer"
                  onPress={() => void leaveAfter(restored(note, Date.now()))}
                />
              </View>
              <View style={styles.flex}>
                <Button label="Supprimer" variant="danger" onPress={deleteForever} />
              </View>
            </>
          ) : (
            <>
              <View style={styles.flex}>
                <Button
                  label={note.archived ? 'Désarchiver' : 'Archiver'}
                  disabled={isBlank(note)}
                  onPress={() => void leaveAfter(withArchived(note, !note.archived, Date.now()))}
                />
              </View>
              <View style={styles.flex}>
                <Button
                  label="Corbeille"
                  variant="danger"
                  disabled={isBlank(note)}
                  onPress={() => void leaveAfter(trashed(note, Date.now()))}
                />
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  inner: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  title: { fontSize: 24, fontWeight: 700, paddingVertical: Spacing.one },
  // Sans cela, la rangée défilante se partage la hauteur libre avec le texte.
  chipScroll: { flexGrow: 0 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  body: { fontSize: 16, lineHeight: 24, minHeight: 240, flexGrow: 1 },
  error: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
});
