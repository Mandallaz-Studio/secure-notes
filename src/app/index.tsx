import { Link, Stack } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function NotesScreen() {
  const theme = useTheme();

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" accessibilityRole="button">
              <ThemedText style={{ color: theme.tint }}>Réglages</ThemedText>
            </Link>
          ),
        }}
      />
      <ThemedText type="subtitle">Aucune note</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.centered}>
        Les notes arriveront avec la phase 2. Les essais techniques sont dans Réglages.
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  centered: { textAlign: 'center' },
});
