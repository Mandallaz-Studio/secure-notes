import {
  PlaceholderBridge,
  RichText,
  TenTapStartKit,
  useBridgeState,
  useEditorBridge,
} from '@10play/tentap-editor';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Baseline,
  Bold,
  Code,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Redo2,
  Strikethrough,
  TextQuote,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { NoteBodyProps } from '@/components/note-body.types';
import { Icon } from '@/components/icon';
import { IconButton } from '@/components/icon-button';
import { ThemedText } from '@/components/themed-text';
import { EDITOR_FONT_FACES } from '@/constants/editor-fonts';
import {
  Colors,
  NotePalette,
  Radius,
  Sizes,
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
    theme: { webview: { backgroundColor: colors.surface } } as never,
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
      `${EDITOR_FONT_FACES}
       body { background-color: ${colors.surface}; color: ${colors.ink};
              font-family: 'IBM Plex Sans', system-ui, sans-serif;
              font-size: 16px; line-height: 1.5; }
       strong, b { font-weight: 600; }
       h1, h2, h3 { font-weight: 600; letter-spacing: -0.01em; }
       h1 { font-size: 24px; line-height: 30px; }
       h2 { font-size: 20px; line-height: 26px; }
       h3 { font-size: 17px; line-height: 24px; }
       mark { color: inherit; border-radius: 3px; padding: 0 2px; }
       a { color: ${colors.accent}; }
       code, pre { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 13px; }
       code { background-color: ${colors.surfaceSunken}; border-radius: 4px; padding: 1px 4px; }
       pre { background-color: ${colors.surfaceSunken}; border-radius: 6px; padding: 8px 12px; }
       pre code { background: none; padding: 0; }
       blockquote { border-left: 2px solid ${colors.borderStrong}; margin-left: 0; padding-left: 12px;
                    color: ${colors.inkMuted}; }
       ul[data-type="taskList"] input[type="checkbox"] { accent-color: ${colors.accent}; }
       img { display: block; border-radius: 8px; margin: 8px 0; }
       .ProseMirror p.is-editor-empty:first-child::before { color: ${colors.inkSubtle}; }`,
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
  /** Rangée de couleurs ouverte au-dessus de la barre. */
  const [panel, setPanel] = useState<'color' | 'highlight' | null>(null);
  const togglePanel = (next: 'color' | 'highlight') =>
    setPanel((current) => (current === next ? null : next));

  return (
    <View style={styles.container}>
      <View style={styles.editor}>
        <RichText editor={editor} />
      </View>
      {imageError && (
        <ThemedText themeColor="danger" type="callout" style={styles.error}>
          {imageError}
        </ThemedText>
      )}
      {showToolbar && (
        <View style={[styles.toolbar, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {panel === 'color' && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              contentContainerStyle={styles.panel}>
              <Swatch
                name="Couleur du texte par défaut"
                active={state.activeColor === undefined}
                onPress={editor.unsetColor}
              />
              {(Object.keys(palette.text) as NoteTextColor[]).map((token) => (
                <Swatch
                  key={token}
                  name={`Texte ${TEXT_COLOR_NAMES[token]}`}
                  color={palette.text[token]}
                  active={sameColor(state.activeColor, palette.text[token])}
                  onPress={() => editor.setColor(palette.text[token])}
                />
              ))}
            </ScrollView>
          )}
          {panel === 'highlight' && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              contentContainerStyle={styles.panel}>
              <Swatch
                name="Sans surlignage"
                active={state.activeHighlight === undefined}
                onPress={editor.unsetHighlight}
              />
              {(Object.keys(palette.highlight) as NoteHighlightColor[]).map((token) => (
                <Swatch
                  key={token}
                  name={`Surlignage ${HIGHLIGHT_NAMES[token]}`}
                  background={palette.highlight[token]}
                  active={sameColor(state.activeHighlight, palette.highlight[token])}
                  onPress={() => editor.setHighlight(palette.highlight[token])}
                />
              ))}
            </ScrollView>
          )}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={styles.toolbarContent}>
            <Tool icon={Undo2} name="Annuler" disabled={!state.canUndo} onPress={editor.undo} />
            <Tool icon={Redo2} name="Rétablir" disabled={!state.canRedo} onPress={editor.redo} />
            <Separator />
            <Tool icon={Bold} name="Gras" active={state.isBoldActive} onPress={editor.toggleBold} />
            <Tool icon={Italic} name="Italique" active={state.isItalicActive} onPress={editor.toggleItalic} />
            <Tool
              icon={Underline}
              name="Souligné"
              active={state.isUnderlineActive}
              onPress={editor.toggleUnderline}
            />
            <Tool
              icon={Strikethrough}
              name="Barré"
              active={state.isStrikeActive}
              onPress={editor.toggleStrike}
            />
            <Tool icon={Code} name="Code" active={state.isCodeActive} onPress={editor.toggleCode} />
            <Separator />
            {([1, 2, 3] as const).map((level) => (
              <Tool
                key={level}
                icon={HEADING_ICONS[level]}
                name={`Titre de niveau ${level}`}
                active={state.headingLevel === level}
                onPress={() => editor.toggleHeading(level)}
              />
            ))}
            <Separator />
            <Tool
              icon={List}
              name="Liste à puces"
              active={state.isBulletListActive}
              onPress={editor.toggleBulletList}
            />
            <Tool
              icon={ListOrdered}
              name="Liste numérotée"
              active={state.isOrderedListActive}
              onPress={editor.toggleOrderedList}
            />
            <Tool
              icon={ListChecks}
              name="Liste de tâches"
              active={state.isTaskListActive}
              onPress={editor.toggleTaskList}
            />
            <Tool
              icon={TextQuote}
              name="Citation"
              active={state.isBlockquoteActive}
              onPress={editor.toggleBlockquote}
            />
            <Separator />
            <Tool
              icon={Baseline}
              name="Couleur du texte"
              active={panel === 'color' || state.activeColor !== undefined}
              onPress={() => togglePanel('color')}
            />
            <Tool
              icon={Highlighter}
              name="Surlignage"
              active={panel === 'highlight' || state.activeHighlight !== undefined}
              onPress={() => togglePanel('highlight')}
            />
            <Tool icon={ImageIcon} name="Ajouter une image" disabled={pickingImage} onPress={insertImage} />
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const HEADING_ICONS = { 1: Heading1, 2: Heading2, 3: Heading3 } as const;

type ToolProps = {
  icon: LucideIcon;
  /** Nom lu par les lecteurs d'écran. */
  name: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

function Tool({ icon, name, active, disabled, onPress }: ToolProps) {
  return (
    <IconButton icon={icon} label={name} active={active} disabled={disabled} size={36} onPress={onPress} />
  );
}

type SwatchProps = {
  name: string;
  active: boolean;
  /** Couleur de texte proposée (aperçu sur un « A »). */
  color?: string;
  /** Surlignage proposé. */
  background?: string;
  onPress: () => void;
};

/** Case d'une couleur de note ; sans couleur ni fond, c'est la gomme. */
function Swatch({ name, active, color, background, onPress }: SwatchProps) {
  const { scheme } = useThemePreference();
  const colors = Colors[scheme];
  const eraser = color === undefined && background === undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.swatch,
        { backgroundColor: background ?? colors.surfaceSunken },
        active && { borderColor: colors.accent },
      ]}>
      {eraser ? (
        <Icon icon={Eraser} size={18} color="inkMuted" />
      ) : (
        <ThemedText type="headline" style={{ color: color ?? colors.ink }}>
          A
        </ThemedText>
      )}
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
    gap: Spacing.half,
    height: Sizes.toolbar,
    paddingHorizontal: Spacing.two,
  },
  panel: { alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  separator: { width: 1, height: 20, marginHorizontal: Spacing.one },
});
