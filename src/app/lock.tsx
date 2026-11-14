import { Fingerprint } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { confirmDestructive } from '@/components/confirm';
import { Logo } from '@/components/logo';
import { Notice } from '@/components/notice';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useVault } from '@/vault/vault-context';

export default function LockScreen() {
  const { unlock, destroy } = useVault();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const tryUnlock = async () => {
    setBusy(true);
    const ok = await unlock();
    // En cas de succès, cet écran est remplacé par l'app.
    if (!ok) {
      setBusy(false);
      setFailed(true);
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
        <View style={styles.block}>
          <Button
            label="Déverrouiller"
            icon={Fingerprint}
            variant="primary"
            disabled={busy}
            onPress={tryUnlock}
          />
          {failed && (
            <Button label="Supprimer et restaurer avec la phrase" variant="danger" onPress={reset} />
          )}
        </View>
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
      {failed && (
        <Notice tone="danger" title="Déverrouillage échoué ou annulé">
          Si les empreintes ou le visage enregistrés sur ce téléphone ont changé, la clé n&apos;est
          plus récupérable : restaurez le coffre avec vos 24 mots.
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
