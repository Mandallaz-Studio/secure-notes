import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

/** Symbole Secure Notes : un cadenas dont le corps porte trois lignes de texte. */
export function Logo({ size = 56 }: { size?: number }) {
  const theme = useTheme();
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Secure Notes">
      <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path d="M21 27V20a11 11 0 0 1 22 0v7" fill="none" stroke={theme.accent} strokeWidth={5.5} strokeLinecap="round" />
      <Rect x={10} y={25} width={44} height={33} rx={8} fill={theme.accent} />
      <Rect x={19} y={34} width={26} height={3.5} rx={1.75} fill={theme.surface} />
      <Rect x={19} y={40.25} width={26} height={3.5} rx={1.75} fill={theme.surface} />
      <Rect x={19} y={46.5} width={15} height={3.5} rx={1.75} fill={theme.surface} />
      </Svg>
    </View>
  );
}
