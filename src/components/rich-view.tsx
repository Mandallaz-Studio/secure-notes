import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Linking, StyleSheet, Text, View, type TextStyle } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { toDisplayDoc, type RichMark, type RichNode } from '@/notes/rich-text';
import { useThemePreference } from '@/theme/theme-preference';

/**
 * Affichage en lecture seule d'un document de note, sans éditeur ni WebView :
 * sert à la lecture d'une note partagée, dans l'app comme sur la page web.
 *
 * Le document vient d'un tiers (l'auteur du lien) : rien n'y est interprété
 * comme du code, une image n'est affichée que si elle est incluse dans le
 * document (`data:`), et un lien ne s'ouvre que s'il est en http(s).
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i;
const WEB_LINK = /^https?:\/\//i;

const HEADING_SIZES: Record<number, TextStyle> = {
  1: { fontSize: 26, lineHeight: 34, fontWeight: 700 },
  2: { fontSize: 22, lineHeight: 30, fontWeight: 700 },
  3: { fontSize: 18, lineHeight: 26, fontWeight: 600 },
};

function SharedImage({ uri }: { uri: string }) {
  // Taille réelle de l'image, connue une fois chargée : elle n'est jamais agrandie.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <Image
      source={{ uri }}
      contentFit="contain"
      accessibilityLabel="Image"
      style={[
        styles.image,
        size
          ? { maxWidth: size.width, aspectRatio: size.width / size.height }
          : { aspectRatio: 16 / 9 },
      ]}
      onLoad={(event) => {
        const { width, height } = event.source;
        if (width > 0 && height > 0) setSize({ width, height });
      }}
    />
  );
}

export function RichView({ doc }: { doc: RichNode }) {
  const theme = useTheme();
  const { scheme } = useThemePreference();
  const shown = toDisplayDoc(doc, scheme);
  const base: TextStyle = { color: theme.text, fontSize: 16, lineHeight: 24 };

  const markStyle = (marks: RichMark[] | undefined): TextStyle => {
    const style: Mutable<TextStyle> = {};
    const lines: string[] = [];
    for (const mark of marks ?? []) {
      const color = mark.attrs?.color;
      if (mark.type === 'bold') style.fontWeight = 700;
      else if (mark.type === 'italic') style.fontStyle = 'italic';
      else if (mark.type === 'underline') lines.push('underline');
      else if (mark.type === 'strike') lines.push('line-through');
      else if (mark.type === 'code') {
        style.fontFamily = Fonts?.mono;
        style.backgroundColor = theme.backgroundElement;
      } else if (mark.type === 'textStyle' && typeof color === 'string' && color !== 'inherit') {
        style.color = color;
      } else if (mark.type === 'highlight') {
        style.backgroundColor = typeof color === 'string' && color !== 'inherit' ? color : '#FFF3A3';
      } else if (mark.type === 'link') {
        style.color = theme.tint;
        lines.push('underline');
      }
    }
    if (lines.length > 0) {
      style.textDecorationLine = [...new Set(lines)].join(' ') as TextStyle['textDecorationLine'];
    }
    return style;
  };

  const inline = (node: RichNode, key: number): ReactNode => {
    if (node.type === 'hardBreak') return '\n';
    if (node.type !== 'text') return (node.content ?? []).map(inline);
    const href = node.marks?.find((mark) => mark.type === 'link')?.attrs?.href;
    const link = typeof href === 'string' && WEB_LINK.test(href) ? href : null;
    return (
      <Text
        key={key}
        style={markStyle(node.marks)}
        accessibilityRole={link ? 'link' : undefined}
        onPress={link ? () => void Linking.openURL(link) : undefined}>
        {node.text ?? ''}
      </Text>
    );
  };

  /** Ligne de texte ; les images qu'elle contiendrait sont sorties à part. */
  const textBlock = (node: RichNode, key: number, style?: TextStyle): ReactNode => {
    const parts: ReactNode[] = [];
    let run: RichNode[] = [];
    const flush = () => {
      if (run.length === 0) return;
      parts.push(
        <Text key={parts.length} style={[base, style]}>
          {run.map(inline)}
        </Text>,
      );
      run = [];
    };
    for (const child of node.content ?? []) {
      if (child.type === 'image') {
        flush();
        parts.push(block(child, parts.length));
      } else {
        run.push(child);
      }
    }
    flush();
    if (parts.length === 0) return <Text key={key} style={[base, style]}>{' '}</Text>;
    return parts.length === 1 ? (
      <View key={key}>{parts}</View>
    ) : (
      <View key={key} style={styles.stack}>
        {parts}
      </View>
    );
  };

  const listItems = (node: RichNode, bullet: (index: number, item: RichNode) => string) =>
    (node.content ?? []).map((item, index) => (
      <View key={index} style={styles.item}>
        <Text style={[base, styles.bullet, { color: theme.textSecondary }]}>
          {bullet(index, item)}
        </Text>
        <View style={styles.itemBody}>{(item.content ?? []).map(block)}</View>
      </View>
    ));

  const block = (node: RichNode, key: number): ReactNode => {
    switch (node.type) {
      case 'paragraph':
        return textBlock(node, key);
      case 'heading': {
        const level = Number(node.attrs?.level);
        return textBlock(node, key, HEADING_SIZES[level] ?? HEADING_SIZES[3]);
      }
      case 'codeBlock':
        return textBlock(node, key, {
          fontFamily: Fonts?.mono,
          fontSize: 14,
          lineHeight: 20,
          backgroundColor: theme.backgroundElement,
          padding: Spacing.two,
          borderRadius: 6,
        });
      case 'bulletList':
        return (
          <View key={key} style={styles.stack}>
            {listItems(node, () => '•')}
          </View>
        );
      case 'orderedList': {
        const start = Number(node.attrs?.start) || 1;
        return (
          <View key={key} style={styles.stack}>
            {listItems(node, (index) => `${start + index}.`)}
          </View>
        );
      }
      case 'taskList':
        return (
          <View key={key} style={styles.stack}>
            {listItems(node, (_, item) => (item.attrs?.checked ? '☑' : '☐'))}
          </View>
        );
      case 'blockquote':
        return (
          <View key={key} style={[styles.quote, { borderColor: theme.border }]}>
            {(node.content ?? []).map(block)}
          </View>
        );
      case 'image': {
        const src = node.attrs?.src;
        return typeof src === 'string' && DATA_IMAGE.test(src) ? (
          <SharedImage key={key} uri={src} />
        ) : null;
      }
      case 'horizontalRule':
        return <View key={key} style={[styles.rule, { backgroundColor: theme.border }]} />;
      default:
        // Type inconnu : on affiche ce qu'il contient plutôt que de le perdre.
        return node.content ? (
          <View key={key} style={styles.stack}>
            {node.content.map(block)}
          </View>
        ) : null;
    }
  };

  return <View style={styles.doc}>{(shown.content ?? []).map(block)}</View>;
}

const styles = StyleSheet.create({
  doc: { gap: Spacing.two + Spacing.one },
  stack: { gap: Spacing.one },
  item: { flexDirection: 'row', gap: Spacing.two },
  bullet: { minWidth: 20, textAlign: 'right' },
  itemBody: { flex: 1, gap: Spacing.one },
  quote: { borderLeftWidth: 3, paddingLeft: Spacing.three, gap: Spacing.one },
  image: { width: '100%', borderRadius: 8 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.two },
});
