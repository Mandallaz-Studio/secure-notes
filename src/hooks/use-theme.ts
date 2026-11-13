import { Colors } from '@/constants/theme';
import { useThemePreference } from '@/theme/theme-preference';

/** Couleurs du thème actuellement appliqué. */
export function useTheme() {
  return Colors[useThemePreference().scheme];
}
