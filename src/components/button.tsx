import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radius, Sizes, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid';

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  /**
   * primary : une seule par écran · secondary : par défaut · ghost : action tertiaire ·
   * danger : destructive (confirmée ensuite) · danger-solid : bouton final d'une confirmation.
   */
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  icon?: LucideIcon;
};

const LOOK: Record<
  ButtonVariant,
  { background: ThemeColor | 'transparent'; pressed: ThemeColor; text: ThemeColor; outlined: boolean }
> = {
  primary: { background: 'accent', pressed: 'accentPressed', text: 'onAccent', outlined: false },
  secondary: { background: 'surface', pressed: 'surfaceSelected', text: 'ink', outlined: true },
  ghost: { background: 'transparent', pressed: 'accentSubtle', text: 'accent', outlined: false },
  danger: { background: 'surface', pressed: 'dangerSubtle', text: 'danger', outlined: true },
  'danger-solid': { background: 'danger', pressed: 'danger', text: 'onDanger', outlined: false },
};

export function Button({
  label,
  variant = 'secondary',
  size = 'md',
  icon,
  disabled,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const look = LOOK[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      {...rest}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' && styles.small,
        {
          backgroundColor: pressed
            ? theme[look.pressed]
            : look.background === 'transparent'
              ? 'transparent'
              : theme[look.background],
          borderColor: look.outlined ? theme.borderStrong : 'transparent',
          opacity: disabled ? 0.4 : 1,
        },
      ]}>
      <View style={styles.content}>
        {icon && <Icon icon={icon} size={size === 'sm' ? 18 : Sizes.icon} color={look.text} />}
        <ThemedText type={size === 'sm' ? 'label' : 'bodyStrong'} themeColor={look.text} numberOfLines={1}>
          {label}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: Sizes.control,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { minHeight: Sizes.controlSmall, paddingHorizontal: 12 },
  content: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
