import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, type PressableProps } from 'react-native';

import { Icon } from '@/components/icon';
import { Radius, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type IconButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  icon: LucideIcon;
  /** Nom lu par les lecteurs d'écran : obligatoire. */
  label: string;
  /** Outil à bascule actif (barre d'édition). */
  active?: boolean;
  tone?: 'default' | 'accent' | 'danger';
  size?: number;
  /** Icône pleine (par exemple une étoile allumée). */
  filled?: boolean;
};

/** Bouton carré portant une seule icône : en-têtes et barre d'édition. */
export function IconButton({
  icon,
  label,
  active,
  tone = 'default',
  size = 40,
  filled,
  disabled,
  ...rest
}: IconButtonProps) {
  const theme = useTheme();
  const color: ThemeColor = disabled
    ? 'inkSubtle'
    : active || tone === 'accent'
      ? 'accent'
      : tone === 'danger'
        ? 'danger'
        : 'ink';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: active }}
      disabled={disabled}
      hitSlop={4}
      {...rest}
      style={({ pressed }) => [
        styles.button,
        {
          width: size,
          height: size,
          backgroundColor: active || pressed ? theme.surfaceSelected : 'transparent',
          opacity: disabled ? 0.55 : 1,
        },
      ]}>
      <Icon icon={icon} color={color} filled={filled} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
});
