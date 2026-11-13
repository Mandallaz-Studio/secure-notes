import { Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  selected?: boolean;
};

export function Button({ label, selected, ...rest }: ButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      {...rest}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: selected ? theme.tint : theme.backgroundElement,
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      <ThemedText style={selected ? { color: theme.background, fontWeight: 600 } : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
    alignItems: 'center',
  },
});
