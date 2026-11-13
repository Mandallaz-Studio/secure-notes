import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/** Le web ne sert qu'à lire les notes partagées : l'éditeur n'y est pas embarqué. */
export function EditorSpike() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText themeColor="textSecondary">
        L&apos;éditeur n&apos;est disponible que sur iOS et Android.
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
});
