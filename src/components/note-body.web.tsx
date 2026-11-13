import { useImperativeHandle, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import type { NoteBodyProps } from '@/components/note-body.types';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { BodyContent } from '@/notes/types';

/**
 * Corps d'une note sur le web : texte brut. L'éditeur riche n'y est pas
 * embarqué (le web ne sert qu'à lire les notes partagées) ; une note mise en
 * forme y est montrée en lecture seule, par son texte.
 */
export function NoteBody({ initial, editable, onChange, ref }: NoteBodyProps) {
  const theme = useTheme();
  const [text, setText] = useState(initial.plainText);
  const isPlain = initial.bodyFormat === 'text';
  const content = (value: string): BodyContent => ({
    body: value,
    bodyFormat: 'text',
    plainText: value,
  });

  useImperativeHandle(ref, () => ({
    read: async () => (isPlain ? content(text) : null),
  }));

  return (
    <TextInput
      accessibilityLabel="Contenu de la note"
      placeholder="Écrivez ici…"
      placeholderTextColor={theme.textSecondary}
      value={text}
      editable={editable && isPlain}
      multiline
      textAlignVertical="top"
      onChangeText={(value) => {
        setText(value);
        onChange(content(value));
      }}
      style={[styles.body, { color: theme.text }]}
    />
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, fontSize: 16, lineHeight: 24, paddingHorizontal: Spacing.three },
});
