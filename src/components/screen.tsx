import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ScreenProps = {
  children: ReactNode;
  /** À activer sur les écrans sans en-tête, pour ne pas passer sous la barre d'état. */
  withoutHeader?: boolean;
};

/** Page défilante, centrée et limitée en largeur sur grand écran. */
export function Screen({ children, withoutHeader }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[
        styles.content,
        withoutHeader && { paddingTop: insets.top + Spacing.three },
      ]}
      contentInsetAdjustmentBehavior={withoutHeader ? 'never' : 'automatic'}
      keyboardShouldPersistTaps="handled">
      <View style={styles.inner}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.four },
});
