import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSync } from '@/sync/sync-context';

/** Avancement du retrait de l'ancien coffre ; rien quand il n'y en a pas. */
export function RetirementNotice() {
  const { retirement, retryRetirement } = useSync();

  switch (retirement.state) {
    case 'none':
      return null;
    case 'waiting':
      return (
        <ThemedText themeColor="textSecondary" type="small">
          Ancien coffre : en attente. {retirement.detail}
        </ThemedText>
      );
    case 'running':
      return (
        <ThemedText themeColor="textSecondary" type="small">
          Ancien coffre : fermeture de l&apos;ancien compte en cours…
        </ThemedText>
      );
    case 'error':
      return (
        <View style={styles.block}>
          <ThemedText themeColor="danger" type="small">
            Ancien coffre : la fermeture de l&apos;ancien compte a échoué ({retirement.error}). Elle
            sera retentée à la prochaine synchronisation.
          </ThemedText>
          <Button label="Réessayer maintenant" onPress={retryRetirement} />
        </View>
      );
    case 'done': {
      const { sharesMoved, sharesRevoked } = retirement.report;
      return (
        <ThemedText themeColor="success" type="small">
          Ancien coffre retiré : son compte est vidé et fermé.
          {sharesMoved > 0 && ` ${sharesMoved} lien(s) de partage repris par le nouveau compte.`}
          {sharesRevoked > 0 && ` ${sharesRevoked} lien(s) de partage révoqué(s).`}
        </ThemedText>
      );
    }
  }
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
});
