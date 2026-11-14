import { StyleSheet, View } from 'react-native';

import { NewPhraseFlow } from '@/components/new-phrase';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useVault } from '@/vault/vault-context';

export default function CreateVaultScreen() {
  const { openWithEntropy } = useVault();

  return (
    <NewPhraseFlow
      confirmLabel="Créer le coffre"
      failure="Le coffre n'a pas pu être enregistré"
      // Dès que le coffre est ouvert, cet écran disparaît.
      onConfirmed={openWithEntropy}
      intro={
        <View style={styles.block}>
          <ThemedText type="title">Votre phrase de récupération</ThemedText>
          <ThemedText>
            L&apos;app va afficher 24 mots. Ils sont le seul moyen de retrouver vos notes sur un
            autre appareil ou après une réinstallation.
          </ThemedText>
          <ThemedText themeColor="danger">
            Ils ne seront affichés qu&apos;une seule fois. Notez-les sur papier, dans l&apos;ordre,
            et gardez-les en lieu sûr. Personne ne pourra vous les redonner.
          </ThemedText>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
});
