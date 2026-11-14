import { Tag, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FontFiles, Radius, Sizes, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ChipProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  selected?: boolean;
  icon?: LucideIcon;
  /** `action` : petite action en ligne (« Gérer », « Joindre un fichier »). */
  variant?: 'filter' | 'action';
};

/** Pastille de filtre (catégories) ou petite action en ligne. */
export function Chip({ label, selected, icon, variant = 'filter', ...rest }: ChipProps) {
  const theme = useTheme();
  const action = variant === 'action';
  const color = action || selected ? 'accent' : 'ink';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={action ? undefined : { selected: !!selected }}
      {...rest}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: action
            ? pressed
              ? theme.accentSubtle
              : 'transparent'
            : selected
              ? theme.accentSubtle
              : pressed
                ? theme.surfaceSelected
                : theme.surfaceSunken,
          borderColor: action ? theme.border : selected ? theme.accent : 'transparent',
        },
      ]}>
      {icon && <Icon icon={icon} size={16} color={color} />}
      <ThemedText type="label" themeColor={color} numberOfLines={1} style={styles.label}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Étiquette non interactive de la catégorie d'une note. */
export function CategoryTag({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.tag, { backgroundColor: theme.accentSubtle }]}>
      <Icon icon={Tag} size={12} color="accent" strokeWidth={2} />
      <ThemedText type="caption" themeColor="accent" numberOfLines={1} style={styles.tagLabel}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: Sizes.chip,
    paddingHorizontal: 12,
    borderRadius: Radius.full,
    borderWidth: 1,
    maxWidth: 220,
  },
  label: { flexShrink: 1 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Radius.sm,
    maxWidth: 200,
  },
  tagLabel: { fontFamily: FontFiles.sans500, flexShrink: 1 },
});
