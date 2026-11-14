import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Logo } from '@/components/logo';
import { Notice } from '@/components/notice';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export default function WelcomeScreen() {
  return (
    <Screen
      withoutHeader
      footer={
        <View style={styles.block}>
          <Link href="/onboarding/create" asChild>
            <Button label="Créer un coffre" variant="primary" />
          </Link>
          <Link href="/onboarding/restore" asChild>
            <Button label="J'ai déjà une phrase de récupération" />
          </Link>
        </View>
      }>
      <View style={styles.hero}>
        <Logo size={56} />
        <View style={styles.block}>
          <ThemedText type="display" accessibilityRole="header">
            Secure Notes
          </ThemedText>
          <ThemedText themeColor="inkMuted">
            Des notes chiffrées de bout en bout, sur votre téléphone d&apos;abord.
          </ThemedText>
        </View>
      </View>
      <Notice tone="secure" title="Chiffré sur cet appareil">
        Personne d&apos;autre ne peut lire vos notes, pas même le serveur de synchronisation.
      </Notice>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  hero: { gap: Spacing.four, paddingTop: Spacing.six },
});
