import {
  darkEditorTheme,
  defaultEditorTheme,
  EditorKeyboardAvoidingView,
  RichText,
  Toolbar,
  useEditorBridge,
  type EditorTheme,
} from '@10play/tentap-editor';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Colors, NotePalette, Spacing } from '@/constants/theme';
import { useThemePreference } from '@/theme/theme-preference';

const INITIAL_CONTENT = `
<h1>Titre de niveau 1</h1>
<h2>Titre de niveau 2</h2>
<p>Du texte <strong>gras</strong>, <em>italique</em>, <u>souligné</u> et <s>barré</s>.</p>
<ul><li>Une liste</li><li>à puces</li></ul>
<p>Sélectionne du texte puis essaie les boutons de couleur.</p>
`;

export function EditorSpike() {
  const { scheme } = useThemePreference();
  const colors = Colors[scheme];
  const palette = NotePalette[scheme];
  const [json, setJson] = useState<string | null>(null);

  const editorTheme: EditorTheme = scheme === 'dark' ? darkEditorTheme : defaultEditorTheme;

  const editor = useEditorBridge({
    avoidIosKeyboard: true,
    initialContent: INITIAL_CONTENT,
    // Le type récursif attendu par TenTap dépasse la profondeur admise par TypeScript.
    theme: editorTheme as never,
  });

  // Le contenu de la WebView suit le thème de l'app.
  useEffect(() => {
    editor.injectCSS(
      // Sur `body` seulement : une règle `*` écraserait les couleurs posées sur le texte.
      `body { background-color: ${colors.surface}; color: ${colors.ink}; }
       mark { color: inherit; }`,
      'app-theme',
    );
  }, [editor, colors.surface, colors.ink]);

  return (
    <EditorKeyboardAvoidingView style={[styles.flex, { backgroundColor: colors.surface }]}>
      <View style={styles.actions}>
        <Button label="Rouge" onPress={() => editor.setColor(palette.text.red)} />
        <Button label="Bleu" onPress={() => editor.setColor(palette.text.blue)} />
        <Button label="Surligner" onPress={() => editor.setHighlight(palette.highlight.yellow)} />
        <Button
          label="JSON"
          onPress={async () => setJson(JSON.stringify(await editor.getJSON(), null, 2))}
        />
      </View>
      <View style={styles.editor}>
        <RichText editor={editor} />
      </View>
      {json && (
        <ScrollView style={[styles.json, { borderColor: colors.border }]}>
          <ThemedText type="code" selectable>
            {json}
          </ThemedText>
        </ScrollView>
      )}
      <View style={styles.toolbar}>
        <Toolbar editor={editor} />
      </View>
    </EditorKeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, padding: Spacing.three },
  editor: { flex: 1, paddingHorizontal: Spacing.three },
  json: { maxHeight: 180, borderTopWidth: 1, padding: Spacing.three },
  toolbar: { flexDirection: 'row' },
});
