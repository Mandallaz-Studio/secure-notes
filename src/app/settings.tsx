import { Link } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { NotePalette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemePreference, type ThemePreference } from '@/theme/theme-preference';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Système' },
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const { preference, scheme, setPreference } = useThemePreference();
  const palette = NotePalette[scheme];

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic">
      <View style={styles.section}>
        <ThemedText type="subtitle">Thème</ThemedText>
        <View style={styles.row}>
          {THEME_OPTIONS.map((option) => (
            <View key={option.value} style={styles.flex}>
              <Button
                label={option.label}
                selected={preference === option.value}
                onPress={() => setPreference(option.value)}
              />
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <ThemedText type="subtitle">Couleurs des notes</ThemedText>
        <ThemedText themeColor="textSecondary" type="small">
          Les mêmes jetons donnent des teintes différentes selon le thème.
        </ThemedText>
        <View style={styles.wrap}>
          {Object.entries(palette.text).map(([name, color]) => (
            <ThemedText key={name} style={{ color, fontWeight: 600 }}>
              {name}
            </ThemedText>
          ))}
        </View>
        <View style={styles.wrap}>
          {Object.entries(palette.highlight).map(([name, color]) => (
            <ThemedText key={name} style={[styles.highlight, { backgroundColor: color }]}>
              {name}
            </ThemedText>
          ))}
        </View>
      </View>

      {__DEV__ && (
        <View style={styles.section}>
          <ThemedText type="subtitle">Essais techniques</ThemedText>
          <Link href="/dev/crypto" asChild>
            <Button label="Chiffrement (libsodium)" />
          </Link>
          <Link href="/dev/editor" asChild>
            <Button label="Éditeur (TenTap)" />
          </Link>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.five },
  section: { gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  flex: { flex: 1 },
  highlight: { paddingHorizontal: Spacing.two, borderRadius: 4 },
});
