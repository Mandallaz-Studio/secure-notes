import { Link } from 'expo-router';
import { Settings } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/icon-button';
import { NotesBrowser } from '@/components/notes-browser';
import { SyncStatus } from '@/components/sync-status';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function NotesScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <NotesBrowser
        hidden={false}
        header={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <ThemedText type="display" accessibilityRole="header">
                Notes
              </ThemedText>
              <Link href="/settings" asChild>
                <IconButton icon={Settings} label="Réglages" />
              </Link>
            </View>
            <SyncStatus />
          </View>
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, gap: Spacing.half },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginRight: -Spacing.two },
});
