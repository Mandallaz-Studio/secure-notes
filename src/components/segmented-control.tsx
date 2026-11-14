import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radius, Sizes } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SegmentedOption<T extends string> = { value: T; label: string; icon?: LucideIcon };

type SegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
};

/** Choix exclusif entre quelques options courtes (vues, thème). */
export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  const theme = useTheme();

  return (
    <View accessibilityRole="tablist" style={[styles.track, { backgroundColor: theme.surfaceSunken }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.item,
              selected && [styles.selected, { backgroundColor: theme.surface, borderColor: theme.border }],
              !selected && pressed && { backgroundColor: theme.surfaceSelected },
            ]}>
            {option.icon && <Icon icon={option.icon} size={16} color={selected ? 'ink' : 'inkMuted'} />}
            <ThemedText type="label" themeColor={selected ? 'ink' : 'inkMuted'} numberOfLines={1}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 3, gap: 2, borderRadius: Radius.md },
  item: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    height: Sizes.controlSmall - 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selected: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
});
