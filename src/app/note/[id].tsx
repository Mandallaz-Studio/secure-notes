import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { confirmDestructive } from '@/components/confirm';
import { NoteBody } from '@/components/note-body';
import type { NoteBodyHandle } from '@/components/note-body.types';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createNote,
  isBlank,
  restored,
  trashed,
  newId,
  withArchived,
  withAttachments,
  withBody,
  withCategory,
  withTitle,
} from '@/notes/model';
import { noteToMarkdown } from '@/notes/markdown';
import {
  markdownFilesSupported,
  pickAttachment,
  shareFile,
  shareMarkdown,
} from '@/notes/markdown-files';
import { useCategories, useNotes } from '@/notes/notes-context';
import { formatBytes, newImageCache, toEditorImages } from '@/notes/blobs';
import { docOfContent } from '@/notes/rich-text';
import { ImportError } from '@/notes/text-import';
import type { Attachment, Note, NoteStore } from '@/notes/types';

/** Délai entre la dernière frappe et l'enregistrement. */
const SAVE_DELAY_MS = 400;

export default function NoteScreen() {
  const { id, category } = useLocalSearchParams<{ id: string; category?: string }>();
  const { store, revision, invalidate } = useNotes();
  const isNew = id === 'new';
  const [note, setNote] = useState<Note | null>(() =>
    isNew ? createNote(Date.now(), category || null) : null,
  );
  const [missing, setMissing] = useState(false);
  // Change quand la note est remplacée par une version venue d'un autre appareil.
  const [generation, setGeneration] = useState(0);

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
  return (
    <NoteEditor
      key={generation}
      initial={note}
      isNew={isNew && generation === 0}
      store={store}
      revision={revision}
      onChanged={invalidate}
      onReplaced={(replacement) => {
        if (replacement) setNote(replacement);
        else setMissing(true);
        setGeneration((value) => value + 1);
      }}
    />
  );
}

type NoteEditorProps = {
  initial: Note;
  /** La note n'a encore jamais été enregistrée. */
  isNew: boolean;
  store: NoteStore;
  /** Change à chaque écriture dans la base, y compris par la synchronisation. */
  revision: number;
  /** Appelé après chaque écriture, pour rafraîchir les listes. */
  onChanged: () => void;
  /** La synchronisation a remplacé (ou supprimé : `null`) la note affichée. */
  onReplaced: (replacement: Note | null) => void;
};

function NoteEditor({ initial, isNew, store, revision, onChanged, onReplaced }: NoteEditorProps) {
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
  /** L'écran se ferme après une suppression définitive faite ici. */
  const leaving = useRef(false);
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

  // Une version venue d'un autre appareil remplace la note affichée, sauf si
  // des modifications locales attendent d'être enregistrées (elles l'emportent).
  useEffect(() => {
    let cancelled = false;
    store.getNote(initial.id).then(
      (stored) => {
        const known = persisted.current;
        if (cancelled || leaving.current || !known || latest.current !== known) return;
        if (!stored || stored.updatedAt !== known.updatedAt) onReplaced(stored);
      },
      () => {
        // Base fermée entre-temps (verrouillage).
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uniquement quand la base change
  }, [revision]);

  const bodyRef = useRef<NoteBodyHandle>(null);

  /** Dernier état de la note, avec ce que l'éditeur n'a pas encore transmis. */
  const currentNote = async (): Promise<Note> => {
    const content = await bodyRef.current?.read();
    const base = latest.current;
    return content && content.body !== base.body ? withBody(base, content, Date.now()) : base;
  };

  const leaveAfter = async (change: (note: Note, now: number) => Note) => {
    await update(change(await currentNote(), Date.now()), true);
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
    leaving.current = true;
    await store.deleteNote(note.id);
    // Empêche l'enregistrement de fermeture de recréer la note.
    persisted.current = latest.current;
    onChanged();
    router.back();
  };

  const exportMarkdown = async () => {
    try {
      const current = await currentNote();
      // Les images sont incluses dans le fichier exporté.
      const doc = await toEditorImages(docOfContent(current), store, newImageCache());
      await shareMarkdown(current.title, noteToMarkdown(current.title, doc));
    } catch (cause) {
      setSaveError(`La note n'a pas pu être exportée : ${String(cause)}`);
    }
  };

  const describe = (action: string, cause: unknown) =>
    setSaveError(cause instanceof ImportError ? cause.message : `${action} : ${String(cause)}`);

  const attachFile = async () => {
    try {
      const picked = await pickAttachment();
      if (!picked) return;
      const attachment: Attachment = {
        id: newId(),
        name: picked.name,
        mime: picked.mime,
        size: picked.bytes.length,
      };
      // Le contenu d'abord : la note ne référence jamais un fichier absent.
      await store.putBlob(attachment.id, picked.bytes);
      const base = await currentNote();
      await update(withAttachments(base, [...base.attachments, attachment], Date.now()), true);
    } catch (cause) {
      describe("Le fichier n'a pas pu être joint", cause);
    }
  };

  const openAttachment = async (attachment: Attachment) => {
    try {
      const bytes = await store.getBlob(attachment.id);
      if (!bytes) {
        setSaveError(
          `« ${attachment.name} » n'est pas encore sur cet appareil : il arrivera à la prochaine synchronisation.`,
        );
        return;
      }
      await shareFile(attachment.name, bytes, attachment.mime);
    } catch (cause) {
      describe("Le fichier n'a pas pu être ouvert", cause);
    }
  };

  const removeAttachment = async (attachment: Attachment) => {
    const confirmed = await confirmDestructive({
      title: 'Retirer ce fichier ?',
      message: `« ${attachment.name} » sera supprimé de la note.`,
      confirmLabel: 'Retirer',
    });
    if (!confirmed) return;
    const base = await currentNote();
    await update(
      withAttachments(
        base,
        base.attachments.filter((other) => other.id !== attachment.id),
        Date.now(),
      ),
      true,
    );
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: inTrash ? 'Corbeille' : note.archived ? 'Archive' : '',
          headerRight:
            markdownFilesSupported && !isBlank(note)
              ? () => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Exporter en Markdown"
                    hitSlop={8}
                    onPress={exportMarkdown}>
                    <ThemedText style={{ color: theme.tint }}>Exporter</ThemedText>
                  </Pressable>
                )
              : undefined,
        }}
      />
      <KeyboardAvoidingView
        style={styles.inner}
        // Android est bord à bord : sans `behavior`, la vue reste sous le clavier.
        behavior="padding"
        keyboardVerticalOffset={headerHeight}>
        <View style={styles.header}>
          <TextInput
            accessibilityLabel="Titre"
            placeholder="Titre"
            placeholderTextColor={theme.textSecondary}
            value={note.title}
            editable={!inTrash}
            onChangeText={(title) => void update(withTitle(latest.current, title, Date.now()))}
            style={[styles.title, { color: theme.text }]}
          />
          {!inTrash && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={styles.chipScroll}>
              <View style={styles.chips}>
                <Chip
                  label="Sans catégorie"
                  selected={note.categoryId === null}
                  onPress={() => void update(withCategory(latest.current, null, Date.now()))}
                />
                {categories.map((category) => (
                  <Chip
                    key={category.id}
                    label={category.name}
                    selected={note.categoryId === category.id}
                    onPress={() =>
                      void update(withCategory(latest.current, category.id, Date.now()))
                    }
                  />
                ))}
                <Link href="/categories" asChild>
                  <Chip label="Gérer les catégories" />
                </Link>
              </View>
            </ScrollView>
          )}
          {markdownFilesSupported && (!inTrash || note.attachments.length > 0) && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={styles.chipScroll}>
              <View style={styles.chips}>
                {note.attachments.map((attachment) => (
                  <View
                    key={attachment.id}
                    style={[styles.attachment, { backgroundColor: theme.backgroundElement }]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Ouvrir ${attachment.name}`}
                      onPress={() => void openAttachment(attachment)}>
                      <ThemedText type="small" numberOfLines={1} style={styles.attachmentName}>
                        📎 {attachment.name} · {formatBytes(attachment.size)}
                      </ThemedText>
                    </Pressable>
                    {!inTrash && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Retirer ${attachment.name}`}
                        hitSlop={8}
                        onPress={() => void removeAttachment(attachment)}>
                        <ThemedText type="small" themeColor="textSecondary">
                          ✕
                        </ThemedText>
                      </Pressable>
                    )}
                  </View>
                ))}
                {!inTrash && <Chip label="＋ Joindre un fichier" onPress={() => void attachFile()} />}
              </View>
            </ScrollView>
          )}
        </View>

        <NoteBody
          ref={bodyRef}
          initial={initial}
          store={store}
          editable={!inTrash}
          onChange={(content) => void update(withBody(latest.current, content, Date.now()))}
        />

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
                <Button label="Restaurer" onPress={() => void leaveAfter(restored)} />
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
                  onPress={() =>
                    void leaveAfter((current, now) => withArchived(current, !current.archived, now))
                  }
                />
              </View>
              <View style={styles.flex}>
                <Button
                  label="Corbeille"
                  variant="danger"
                  disabled={isBlank(note)}
                  onPress={() => void leaveAfter(trashed)}
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
  header: { padding: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two },
  title: { fontSize: 24, fontWeight: 700, paddingVertical: Spacing.one },
  // Sans cela, la rangée défilante s'étire en hauteur.
  chipScroll: { flexGrow: 0 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + Spacing.half,
    borderRadius: 999,
  },
  attachmentName: { maxWidth: 220 },
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
