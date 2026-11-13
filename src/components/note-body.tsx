import {
  PlaceholderBridge,
  RichText,
  TenTapStartKit,
  useBridgeState,
  useEditorBridge,
} from '@10play/tentap-editor';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { NoteBodyProps } from '@/components/note-body.types';
import { ThemedText } from '@/components/themed-text';
import {
  Colors,
  NotePalette,
  Spacing,
  type NoteHighlightColor,
  type NoteTextColor,
} from '@/constants/theme';
import { newImageCache, toEditorImages, toStoredImages, type ImageCache } from '@/notes/blobs';
import { pickImage } from '@/notes/image-files';
import { contentOfDoc, docOfContent, toDisplayDoc, toStoredDoc, type RichNode } from '@/notes/rich-text';
import type { BodyContent } from '@/notes/types';
import { useThemePreference } from '@/theme/theme-preference';

/** Délai entre la dernière frappe et la lecture du contenu dans l'éditeur. */
const READ_DELAY_MS = 250;

const TEXT_COLOR_NAMES: Record<NoteTextColor, string> = {
  red: 'rouge',
  orange: 'orange',
  green: 'vert',
  blue: 'bleu',
  purple: 'violet',
};

const HIGHLIGHT_NAMES: Record<NoteHighlightColor, string> = {
  yellow: 'jaune',
  green: 'vert',
  blue: 'bleu',
  pink: 'rose',
};

const sameColor = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();

/**
 * Corps d'une note : éditeur riche (TipTap dans une WebView). Les raccourcis
 * Markdown de TipTap sont actifs à la frappe (`# `, `- `, `**gras**`…).
 *
 * Les couleurs sont stockées sous forme de jetons de palette et affichées dans
 * la teinte du thème courant : voir `rich-text.ts`. Les images sont
 * enregistrées à part (blobs) et référencées par le document : voir `blobs.ts`.
 */
export function NoteBody(props: NoteBodyProps) {
  const { initial, store } = props;
  const [images] = useState(newImageCache);
  const [prepared, setPrepared] = useState<RichNode | null>(null);

  // Les images sont lues dans la base avant d'ouvrir l'éditeur.
  useEffect(() => {
    let cancelled = false;
    const doc = docOfContent(initial);
    toEditorImages(doc, store, images).then(
      (ready) => {
        if (!cancelled) setPrepared(ready);
      },
      () => {
        if (!cancelled) setPrepared(doc);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contenu lu une fois, à l'ouverture
  }, []);

  if (!prepared) return <View style={styles.container} />;
  return <Editor {...props} prepared={prepared} images={images} />;
}

type EditorProps = NoteBodyProps & {
  /** Document à l'ouverture, images incluses. */
  prepared: RichNode;
  images: ImageCache;
};

function Editor({ prepared, images, store, editable, onChange, ref }: EditorProps) {
  const { scheme } = useThemePreference();
  const colors = Colors[scheme];
  const palette = NotePalette[scheme];
  const [initialDoc] = useState(() => toDisplayDoc(prepared, scheme));

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingRead = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  /** Lectures en file : une image nouvelle n'est enregistrée qu'une fois. */
  const reads = useRef<Promise<unknown>>(Promise.resolve());
  const readContent = (): Promise<BodyContent> => {
    const next = reads.current.then(async () =>
      contentOfDoc(await toStoredImages((await editor.getJSON()) as RichNode, store, images)),
    );
    reads.current = next.catch(() => {});
    return next;
  };

  const editor = useEditorBridge({
    bridgeExtensions: [
      ...TenTapStartKit,
      PlaceholderBridge.configureExtension({ placeholder: 'Écrivez ici…' }),
    ],
    initialContent: initialDoc,
    editable,
    // Le type récursif attendu par TenTap dépasse la profondeur admise par TypeScript.
    theme: { webview: { backgroundColor: colors.background } } as never,
    onChange: () => {
      cancelPendingRead();
      timer.current = setTimeout(async () => {
        timer.current = null;
        try {
          onChangeRef.current(await readContent());
        } catch {
          // Base fermée entre-temps (verrouillage) : rien à enregistrer.
        }
      }, READ_DELAY_MS);
    },
  });
  const state = useBridgeState(editor);

  useEffect(() => cancelPendingRead, []);

  useImperativeHandle(ref, () => ({
    read: async () => {
      if (!editor.getEditorState().isReady) return null;
      cancelPendingRead();
      return readContent();
    },
  }));

  // Le contenu de la WebView suit le thème de l'app.
  useEffect(() => {
    editor.injectCSS(
      // Sur `body` seulement : une règle `*` écraserait les couleurs posées sur le texte.
      `body { background-color: ${colors.background}; color: ${colors.text};
              font-size: 16px; line-height: 1.5; }
       mark { color: inherit; border-radius: 3px; padding: 0 2px; }
       a { color: ${colors.tint}; }
       code { background-color: ${colors.backgroundElement}; border-radius: 4px; padding: 1px 4px; }
       blockquote { border-left: 3px solid ${colors.border}; margin-left: 0; padding-left: 12px;
                    color: ${colors.textSecondary}; }
       img { display: block; border-radius: 8px; margin: 8px 0; }
       .ProseMirror p.is-editor-empty:first-child::before { color: ${colors.textSecondary}; }`,
      'app-theme',
    );
  }, [editor, colors]);

  // Au changement de thème, les couleurs déjà posées prennent la teinte du nouveau thème.
  const shownScheme = useRef(scheme);
  useEffect(() => {
    if (shownScheme.current === scheme || !editor.getEditorState().isReady) return;
    shownScheme.current = scheme;
    void editor.getJSON().then((doc) => {
      editor.setContent(toDisplayDoc(toStoredDoc(doc as RichNode), scheme), { emitUpdate: false });
    });
  }, [editor, scheme]);

  const [imageError, setImageError] = useState<string | null>(null);
  /** Le sélecteur d'images est ouvert : l'éditeur a perdu le focus, la barre reste. */
  const [pickingImage, setPickingImage] = useState(false);
  const insertImage = async () => {
    setImageError(null);
    setPickingImage(true);
    try {
      const image = await pickImage();
      if (image) editor.setImage(image);
    } catch (cause) {
      setImageError(`L'image n'a pas pu être ajoutée : ${String(cause)}`);
    } finally {
      setPickingImage(false);
    }
  };

  const showToolbar = editable && (state.isFocused || pickingImage);

  return (
    <View style={styles.container}>
      <View style={styles.editor}>
        <RichText editor={editor} />
      </View>
      {imageError && (
        <ThemedText themeColor="danger" type="small" style={styles.error}>
          {imageError}
        </ThemedText>
      )}
      {showToolbar && (
        <View style={[styles.toolbar, { borderColor: colors.border }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={styles.toolbarContent}>
            <Tool label="↶" name="Annuler" disabled={!state.canUndo} onPress={editor.undo} />
            <Tool label="↷" name="Rétablir" disabled={!state.canRedo} onPress={editor.redo} />
            <Separator />
            <Tool label="🖼" name="Ajouter une image" disabled={pickingImage} onPress={insertImage} />
            <Separator />
            <Tool label="G" name="Gras" bold active={state.isBoldActive} onPress={editor.toggleBold} />
            <Tool
              label="I"
              name="Italique"
              italic
              active={state.isItalicActive}
              onPress={editor.toggleItalic}
            />
            <Tool
              label="S"
              name="Souligné"
              decoration="underline"
              active={state.isUnderlineActive}
              onPress={editor.toggleUnderline}
            />
            <Tool
              label="B"
              name="Barré"
              decoration="line-through"
              active={state.isStrikeActive}
              onPress={editor.toggleStrike}
            />
            <Tool label="<>" name="Code" active={state.isCodeActive} onPress={editor.toggleCode} />
            <Separator />
            {([1, 2, 3] as const).map((level) => (
              <Tool
                key={level}
                label={`T${level}`}
                name={`Titre de niveau ${level}`}
                active={state.headingLevel === level}
                onPress={() => editor.toggleHeading(level)}
              />
            ))}
            <Separator />
            <Tool
              label="•"
              name="Liste à puces"
              active={state.isBulletListActive}
              onPress={editor.toggleBulletList}
            />
            <Tool
              label="1."
              name="Liste numérotée"
              active={state.isOrderedListActive}
              onPress={editor.toggleOrderedList}
            />
            <Tool
              label="☑"
              name="Liste de tâches"
              active={state.isTaskListActive}
              onPress={editor.toggleTaskList}
            />
            <Tool
              label="❝"
              name="Citation"
              active={state.isBlockquoteActive}
              onPress={editor.toggleBlockquote}
            />
            <Separator />
            <Tool
              label="A"
              name="Couleur du texte par défaut"
              active={state.activeColor === undefined}
              onPress={editor.unsetColor}
            />
            {(Object.keys(palette.text) as NoteTextColor[]).map((token) => (
              <Tool
                key={token}
                label="A"
                name={`Texte ${TEXT_COLOR_NAMES[token]}`}
                bold
                color={palette.text[token]}
                active={sameColor(state.activeColor, palette.text[token])}
                onPress={() => editor.setColor(palette.text[token])}
              />
            ))}
            <Separator />
            <Tool
              label="∅"
              name="Sans surlignage"
              active={state.activeHighlight === undefined}
              onPress={editor.unsetHighlight}
            />
            {(Object.keys(palette.highlight) as NoteHighlightColor[]).map((token) => (
              <Tool
                key={token}
                label="a"
                name={`Surlignage ${HIGHLIGHT_NAMES[token]}`}
                background={palette.highlight[token]}
                active={sameColor(state.activeHighlight, palette.highlight[token])}
                onPress={() => editor.setHighlight(palette.highlight[token])}
              />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

type ToolProps = {
  /** Texte court affiché sur le bouton. */
  label: string;
  /** Nom lu par les lecteurs d'écran. */
  name: string;
  active?: boolean;
  disabled?: boolean;
  bold?: boolean;
  italic?: boolean;
  decoration?: 'underline' | 'line-through';
  /** Couleur du libellé (aperçu d'une couleur de texte). */
  color?: string;
  /** Fond du libellé (aperçu d'un surlignage). */
  background?: string;
  onPress: () => void;
};

function Tool({
  label,
  name,
  active,
  disabled,
  bold,
  italic,
  decoration,
  color,
  background,
  onPress,
}: ToolProps) {
  const { scheme } = useThemePreference();
  const colors = Colors[scheme];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tool,
        {
          backgroundColor: background ?? (active ? colors.backgroundSelected : 'transparent'),
          borderColor: active ? colors.tint : 'transparent',
          opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
        },
      ]}>
      <ThemedText
        style={{
          color: color ?? colors.text,
          fontWeight: bold ? 700 : 500,
          fontStyle: italic ? 'italic' : 'normal',
          textDecorationLine: decoration ?? 'none',
        }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function Separator() {
  const { scheme } = useThemePreference();
  return <View style={[styles.separator, { backgroundColor: Colors[scheme].border }]} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  editor: { flex: 1, paddingHorizontal: Spacing.three },
  error: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.one },
  toolbar: { borderTopWidth: StyleSheet.hairlineWidth },
  toolbarContent: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one + Spacing.half,
  },
  tool: {
    minWidth: 40,
    height: 40,
    paddingHorizontal: Spacing.two,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  separator: { width: StyleSheet.hairlineWidth, height: 24, marginHorizontal: Spacing.one },
});
