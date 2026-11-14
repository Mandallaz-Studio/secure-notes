import { Text, type TextProps } from 'react-native';

import { Type, type ThemeColor, type TypeStyle } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  /** Style de texte du design system (voir `Type`). */
  type?: TypeStyle;
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'body', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return <Text style={[{ color: theme[themeColor ?? 'ink'] }, Type[type], style]} {...rest} />;
}
