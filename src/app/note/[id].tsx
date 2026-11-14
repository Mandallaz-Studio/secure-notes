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
import {
  Archive,
  ArchiveRestore,
  Download,
  EyeOff,
  FileText,
  Image as ImageIcon,
  LockKeyholeOpen,
  Paperclip,
  Settings2,
  Share2,
  Star,
  Trash2,
  X,
} from 'lucide-react-native';

import { Chip } from '@/components/chip';
import { confirmDestructive } from '@/components/confirm';
import { Icon } from '@/components/icon';
import { IconButton } from '@/components/icon-button';
import { NoteBody } from '@/components/note-body';
import type { NoteBodyHandle } from '@/components/note-body.types';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Sizes, Spacing, Type } from '@/constants/theme';
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
  withHidden,
  withPinned,
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
  const { id, category, hidden } = useLocalSearchParams<{
    id: string;
    category?: string;
    /** `1` : nouvelle note du dossier privé. */
    hidden?: string;
  }>();
  const { store, revision, invalidate } = useNotes();
  const isNew = id === 'new';
  const [note, setNote] = useState<Note | null>(() =>
    isNew ? createNote(Date.now(), category || null, hidden === '1') : null,
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
        <ThemedText themeColor="inkMuted">Cette note n&apos;existe plus.</ThemedText>
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

  const openSharing = async () => {
    // Le lien partage la note telle qu'elle est enregistrée.
    await update(await currentNote(), true);
    router.push({ pathname: '/share/[noteId]', params: { noteId: latest.current.id } });
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

  const blank = isBlank(note);

  return (
    <ThemedView type="surface" style={styles.container}>
      <Stack.Screen
        options={{
          title: inTrash ? 'Corbeille' : note.archived ? 'Archive' : note.hidden ? 'Privée' : '',
          headerStyle: { backgroundColor: theme.surface },
          headerRight: blank
            ? undefined
            : () => (
                <View style={styles.headerActions}>
                  {inTrash ? (
                    <>
                      <IconButton
                        icon={ArchiveRestore}
                        label="Restaurer"
                        onPress={() => void leaveAfter(restored)}
                      />
                      <IconButton
                        icon={Trash2}
                        label="Supprimer définitivement"
                        tone="danger"
                        onPress={deleteForever}
                      />
                    </>
                  ) : (
                    <>
                      <IconButton
                        icon={Star}
                        label={note.pinned ? 'Ne plus mettre en avant' : 'Mettre en avant'}
                        active={note.pinned}
                        filled={note.pinned}
                        onPress={() =>
                          void update(withPinned(latest.current, !latest.current.pinned, Date.now()), true)
                        }
                      />
                      {markdownFilesSupported && (
                        <IconButton
                          icon={Share2}
                          label="Partager par lien"
                          onPress={() => void openSharing()}
                        />
                      )}
                      {markdownFilesSupported && (
                        <IconButton icon={Download} label="Exporter en Markdown" onPress={exportMarkdown} />
                      )}
                      <IconButton
                        icon={note.hidden ? LockKeyholeOpen : EyeOff}
                        label={
                          note.hidden ? 'Sortir du dossier privé' : 'Déplacer dans le dossier privé'
                        }
                        onPress={() =>
                          void leaveAfter((current, now) => withHidden(current, !current.hidden, now))
                        }
                      />
                      <IconButton
                        icon={note.archived ? ArchiveRestore : Archive}
                        label={note.archived ? 'Désarchiver' : 'Archiver'}
                        onPress={() =>
                          void leaveAfter((current, now) => withArchived(current, !current.archived, now))
                        }
                      />
                      <IconButton
                        icon={Trash2}
                        label="Mettre à la corbeille"
                        onPress={() => void leaveAfter(trashed)}
                      />
                    </>
                  )}
                </View>
              ),
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
            placeholderTextColor={theme.inkSubtle}
            selectionColor={theme.accent}
            value={note.title}
            editable={!inTrash}
            multiline
            submitBehavior="blurAndSubmit"
            onChangeText={(title) =>
              void update(withTitle(latest.current, title.replace(/\n/g, ' '), Date.now()))
            }
            style={[styles.title, Type.title, { color: theme.ink }]}
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
                  <Chip
                    label="Gérer"
                    accessibilityLabel="Gérer les catégories"
                    icon={Settings2}
                    variant="action"
                  />
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
                    style={[styles.attachment, { backgroundColor: theme.surfaceSunken }]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Ouvrir ${attachment.name}`}
                      onPress={() => void openAttachment(attachment)}
                      style={styles.attachmentOpen}>
                      <Icon
                        icon={attachment.mime.startsWith('image/') ? ImageIcon : FileText}
                        size={16}
                        color="inkMuted"
                      />
                      <ThemedText type="callout" numberOfLines={1} style={styles.attachmentName}>
                        {attachment.name}
                      </ThemedText>
                      <ThemedText type="caption" themeColor="inkSubtle">
                        {formatBytes(attachment.size)}
                      </ThemedText>
                    </Pressable>
                    {!inTrash && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Retirer ${attachment.name}`}
                        hitSlop={8}
                        onPress={() => void removeAttachment(attachment)}
                        style={styles.attachmentRemove}>
                        <Icon icon={X} size={14} color="inkMuted" />
                      </Pressable>
                    )}
                  </View>
                ))}
                {!inTrash && (
                  <Chip
                    label="Joindre un fichier"
                    icon={Paperclip}
                    variant="action"
                    onPress={() => void attachFile()}
                  />
                )}
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
          <ThemedText themeColor="danger" type="callout" style={styles.error}>
            {saveError}
          </ThemedText>
        )}
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  inner: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  header: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  title: { paddingVertical: Spacing.one },
  // Sans cela, la rangée défilante s'étire en hauteur.
  chipScroll: { flexGrow: 0 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    height: Sizes.chip,
    paddingLeft: 12,
    paddingRight: Spacing.one,
    borderRadius: Radius.full,
  },
  attachmentOpen: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: Spacing.one },
  attachmentName: { maxWidth: 180 },
  attachmentRemove: { padding: 5 },
  error: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
});
