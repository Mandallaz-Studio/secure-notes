import { Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: 'default' | 'primary' | 'danger';
  /** Affiche le bouton comme l'option retenue d'un groupe. */
  selected?: boolean;
};

export function Button({ label, variant = 'default', selected, disabled, ...rest }: ButtonProps) {
  const theme = useTheme();
  const filled = selected || variant === 'primary';
  const backgroundColor = filled ? theme.tint : theme.backgroundElement;
  const color = filled ? theme.background : variant === 'danger' ? theme.danger : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      {...rest}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}>
      <ThemedText style={{ color, fontWeight: filled ? 600 : 400 }}>{label}</ThemedText>
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
