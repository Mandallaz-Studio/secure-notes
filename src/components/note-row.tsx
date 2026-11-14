import { Circle, CircleCheck, Paperclip, Star } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { CategoryTag } from '@/components/chip';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FontFiles, RowPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type NoteRowProps = {
  title: string;
  preview: string;
  date: string;
  category?: string;
  attachments?: number;
  /** Note mise en avant. */
  pinned?: boolean;
  /** Mode sélection : une case précède la ligne. */
  selecting?: boolean;
  selected?: boolean;
  onPress: () => void;
  /** Appui long : entre en mode sélection. */
  onLongPress?: () => void;
};

/** Ligne de la liste des notes. */
export function NoteRow({
  title,
  preview,
  date,
  category,
  attachments,
  pinned,
  selecting,
  selected,
  onPress,
  onLongPress,
}: NoteRowProps) {
  const theme = useTheme();
  const shownTitle = title.trim();

  return (
    // Pas de <Link asChild> ici : sur Android, il fait perdre son style à la ligne.
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${shownTitle || 'Sans titre'}${pinned ? ', en avant' : ''}`}
      accessibilityState={selecting ? { selected: !!selected } : undefined}
      accessibilityHint={selecting ? undefined : 'Appui long pour sélectionner'}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: theme.border,
          backgroundColor: pressed || selected ? theme.surfaceSelected : theme.surface,
        },
      ]}>
      {selecting && (
        <Icon icon={selected ? CircleCheck : Circle} color={selected ? 'accent' : 'inkSubtle'} />
      )}
      <View style={styles.content}>
      <View style={styles.head}>
        {pinned && (
          <View style={styles.pin}>
            <Icon icon={Star} size={14} color="accent" filled />
          </View>
        )}
        <ThemedText
          type="headline"
          themeColor={shownTitle ? 'ink' : 'inkMuted'}
          numberOfLines={1}
          style={[styles.title, !shownTitle && styles.untitled]}>
          {shownTitle || 'Sans titre'}
        </ThemedText>
        <ThemedText type="caption" themeColor="inkSubtle">
          {date}
        </ThemedText>
      </View>
      {preview !== '' && (
        <ThemedText type="callout" themeColor="inkMuted" numberOfLines={2}>
          {preview}
        </ThemedText>
      )}
      {(category || !!attachments) && (
        <View style={styles.meta}>
          {category && <CategoryTag label={category} />}
          {!!attachments && (
            <View style={styles.attachments}>
              <Icon icon={Paperclip} size={14} color="inkSubtle" />
              <ThemedText type="caption" themeColor="inkSubtle">
                {attachments}
              </ThemedText>
            </View>
          )}
        </View>
      )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: RowPadding,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  content: { flex: 1, gap: Spacing.half },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  title: { flex: 1 },
  pin: { alignSelf: 'center' },
  untitled: { fontFamily: FontFiles.sans400Italic },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  attachments: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
});
