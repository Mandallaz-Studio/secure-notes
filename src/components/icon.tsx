import type { LucideIcon } from 'lucide-react-native';

import { IconStroke, Sizes, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type IconProps = {
  icon: LucideIcon;
  size?: number;
  /** Couleur du thème (par défaut `ink`) ou valeur explicite. */
  color?: ThemeColor | (string & {});
  strokeWidth?: number;
  /** Icône pleine, de la même couleur que son trait. */
  filled?: boolean;
};

/** Icône Lucide au trait du design system ; le libellé est porté par le contrôle qui la contient. */
export function Icon({
  icon: Glyph,
  size = Sizes.icon,
  color = 'ink',
  strokeWidth = IconStroke,
  filled,
}: IconProps) {
  const theme = useTheme();
  const resolved = color in theme ? theme[color as ThemeColor] : color;
  return (
    <Glyph size={size} color={resolved} strokeWidth={strokeWidth} fill={filled ? resolved : 'none'} />
  );
}
