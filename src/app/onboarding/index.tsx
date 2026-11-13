import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export default function WelcomeScreen() {
  return (
    <Screen>
      <View style={styles.block}>
        <ThemedText type="title">Secure Notes</ThemedText>
        <ThemedText themeColor="textSecondary">
          Vos notes sont chiffrées sur cet appareil. Personne d&apos;autre ne peut les lire, pas
          même le serveur de synchronisation.
        </ThemedText>
      </View>
      <View style={styles.block}>
        <Link href="/onboarding/create" asChild>
          <Button label="Créer un coffre" variant="primary" />
        </Link>
        <Link href="/onboarding/restore" asChild>
          <Button label="J'ai déjà une phrase de récupération" />
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
});
