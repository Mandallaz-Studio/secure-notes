import { Fingerprint, LockKeyhole } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { confirmDestructive } from '@/components/confirm';
import { Logo } from '@/components/logo';
import { Notice } from '@/components/notice';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useVault, type UnlockResult } from '@/vault/vault-context';

type Failure = Exclude<UnlockResult, 'ok'>;

export default function LockScreen() {
  const { unlock, destroy, restoreWithPhrase, biometricEnabled, keyProblem } = useVault();
  // Clé illisible ou absente au démarrage : on le dit d'emblée, sans attendre un essai.
  const [failure, setFailure] = useState<Failure | null>(keyProblem);
  const [busy, setBusy] = useState(false);

  const tryUnlock = async () => {
    setBusy(true);
    const result = await unlock();
    // En cas de succès, cet écran est remplacé par l'app.
    if (result !== 'ok') {
      setBusy(false);
      setFailure(result);
    }
  };

  const reset = async () => {
    const confirmed = await confirmDestructive({
      title: 'Supprimer le coffre de cet appareil ?',
      message:
        'Vous devrez saisir vos 24 mots pour retrouver vos notes. Sans eux, elles seront définitivement perdues.',
      confirmLabel: 'Supprimer',
    });
    if (confirmed) {
      await destroy();
    }
  };

  return (
    <Screen
      withoutHeader
      footer={
        failure === 'missing' ? (
          // Sans clé, rien à réessayer ; et surtout rien à effacer : la phrase
          // rouvre la base restée sur l'appareil.
          <View style={styles.block}>
            <Button label="Restaurer avec la phrase" variant="primary" onPress={restoreWithPhrase} />
          </View>
        ) : (
          <View style={styles.block}>
            <Button
              label={failure === 'unreadable' ? 'Réessayer' : 'Déverrouiller'}
              icon={biometricEnabled ? Fingerprint : LockKeyhole}
              variant="primary"
              disabled={busy}
              onPress={tryUnlock}
            />
            {failure !== null && (
              <Button label="Supprimer et restaurer avec la phrase" variant="danger" onPress={reset} />
            )}
          </View>
        )
      }>
      <View style={styles.hero}>
        <Logo size={72} />
        <ThemedText type="display" accessibilityRole="header" style={styles.center}>
          Coffre verrouillé
        </ThemedText>
        <ThemedText themeColor="inkMuted" style={styles.center}>
          Authentifiez-vous pour accéder à vos notes.
        </ThemedText>
      </View>
      {failure === 'cancelled' && (
        <Notice tone="danger" title="Déverrouillage échoué ou annulé">
          {biometricEnabled
            ? 'Si les empreintes ou le visage enregistrés sur ce téléphone ont changé, la clé n’est plus récupérable : restaurez le coffre avec vos 24 mots.'
            : 'Réessayez avec le code, le schéma, l’empreinte ou le visage de l’appareil.'}
        </Notice>
      )}
      {failure === 'unreadable' && (
        <Notice tone="warning" title="Clé momentanément illisible">
          Le téléphone n’a pas rendu la clé du coffre. C’est souvent passager : réessayez, ou
          redémarrez le téléphone. Vos notes sont intactes ; ne supprimez le coffre que si vous
          avez vos 24 mots.
        </Notice>
      )}
      {failure === 'missing' && (
        <Notice tone="danger" title="Clé introuvable">
          La clé du coffre n’est plus sur ce téléphone : restaurez le coffre avec vos 24 mots. Les
          notes restées sur l’appareil seront retrouvées.
        </Notice>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  hero: { alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.six, paddingHorizontal: Spacing.three },
  center: { textAlign: 'center' },
});
