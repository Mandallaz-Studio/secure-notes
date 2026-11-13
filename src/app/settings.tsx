import { Link } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { confirmDestructive } from '@/components/confirm';
import { ThemedText } from '@/components/themed-text';
import { NotePalette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemePreference, type ThemePreference } from '@/theme/theme-preference';
import { useVault } from '@/vault/vault-context';

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

      <VaultSection />

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

function VaultSection() {
  const vault = useVault();
  const [error, setError] = useState<string | null>(null);

  const toggleBiometric = async () => {
    setError(null);
    try {
      await vault.setBiometricEnabled(!vault.biometricEnabled);
    } catch {
      setError("La protection n'a pas pu être modifiée (authentification annulée ?).");
    }
  };

  const destroy = async () => {
    const confirmed = await confirmDestructive({
      title: 'Supprimer le coffre de cet appareil ?',
      message:
        'Vous devrez saisir vos 24 mots pour retrouver vos notes. Sans eux, elles seront définitivement perdues.',
      confirmLabel: 'Supprimer',
    });
    if (confirmed) {
      await vault.destroy();
    }
  };

  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">Coffre</ThemedText>
      <ThemedText themeColor="textSecondary" type="small">
        Identifiant du compte : {vault.accountId?.slice(0, 8)}…
      </ThemedText>
      <ThemedText themeColor="textSecondary" type="small">
        La phrase de récupération n&apos;est pas conservée et ne peut plus être affichée.
      </ThemedText>
      {vault.biometricAvailable ? (
        <>
          <Button
            label={
              vault.biometricEnabled
                ? 'Désactiver le verrouillage biométrique'
                : 'Activer le verrouillage biométrique'
            }
            onPress={toggleBiometric}
          />
          {vault.biometricEnabled && <Button label="Verrouiller maintenant" onPress={vault.lock} />}
        </>
      ) : (
        <ThemedText themeColor="textSecondary" type="small">
          Verrouillage biométrique indisponible : aucune empreinte ni visage enregistré sur cet
          appareil.
        </ThemedText>
      )}
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}
      <Button label="Supprimer le coffre de cet appareil" variant="danger" onPress={destroy} />
    </View>
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
