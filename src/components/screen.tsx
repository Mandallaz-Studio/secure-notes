import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ScreenProps = {
  children: ReactNode;
  /** À activer sur les écrans sans en-tête, pour ne pas passer sous la barre d'état. */
  withoutHeader?: boolean;
  /** Pied fixé en bas de l'écran (bouton principal), à portée du pouce. */
  footer?: ReactNode;
};

/** Page défilante, centrée et limitée en largeur sur grand écran. */
export function Screen({ children, withoutHeader, footer }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { backgroundColor: theme.canvas }]}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[
          styles.content,
          withoutHeader && { paddingTop: insets.top + Spacing.four },
          !footer && { paddingBottom: insets.bottom + Spacing.four },
        ]}
        contentInsetAdjustmentBehavior={withoutHeader ? 'never' : 'automatic'}
        keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>{children}</View>
      </ScrollView>
      {footer && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View style={styles.inner}>{footer}</View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.three, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.four },
  footer: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, alignItems: 'center' },
});
