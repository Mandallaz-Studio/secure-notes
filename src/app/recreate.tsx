import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { confirmDestructive } from '@/components/confirm';
import { NewPhraseFlow } from '@/components/new-phrase';
import { Notice } from '@/components/notice';
import { RetirementNotice } from '@/components/retirement-notice';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { missingContent, type CopyReport } from '@/notes/copy-store';
import { useNotes } from '@/notes/notes-context';
import { useSync } from '@/sync/sync-context';
import { useVault } from '@/vault/vault-context';

/**
 * « Recréer le coffre » : pour une phrase perdue (ou exposée) alors que cet
 * appareil a encore accès aux notes. Nouvelle phrase, nouveau coffre, même
 * contenu ; l'ancien coffre est ensuite retiré (voir `vault/retire.ts`).
 */
export default function RecreateVaultScreen() {
  const router = useRouter();
  const { recreate } = useVault();
  const { store } = useNotes();
  const { config, status, retirement } = useSync();
  const [step, setStep] = useState<'explain' | 'phrase' | 'done'>('explain');
  const [missing, setMissing] = useState<number | null>(null);
  const [report, setReport] = useState<CopyReport | null>(null);

  useEffect(() => {
    if (!store || step !== 'explain') return;
    let cancelled = false;
    missingContent(store).then(
      (count) => !cancelled && setMissing(count),
      () => !cancelled && setMissing(null),
    );
    return () => {
      cancelled = true;
    };
  }, [store, step, status.lastSyncAt]);

  const unfinished = retirement.state !== 'none' && retirement.state !== 'done';
  const pendingSync = config.enabled && status.state !== 'idle';
  const blocked = unfinished || missing === null || missing > 0;

  if (step === 'phrase') {
    return (
      <NewPhraseFlow
        confirmLabel="Recréer le coffre"
        failure="Le coffre n'a pas pu être recréé (l'ancien reste en place)"
        onConfirmed={async (entropy) => {
          const copied = await recreate(
            entropy,
            config.enabled ? { url: config.url, anonKey: config.anonKey } : null,
          );
          setReport(copied);
          setStep('done');
        }}
        intro={
          <View style={styles.block}>
            <ThemedText type="title" accessibilityRole="header">
              Votre nouvelle phrase
            </ThemedText>
            <ThemedText>
              L&apos;app va afficher 24 nouveaux mots. Ils remplacent l&apos;ancienne phrase, qui ne
              permettra plus de retrouver vos notes.
            </ThemedText>
            <Notice tone="warning" title="Affichés une seule fois">
              Notez-les sur papier, dans l&apos;ordre, et gardez-les en lieu sûr.
            </Notice>
          </View>
        }
      />
    );
  }

  if (step === 'done' && report) {
    return (
      <Screen footer={<Button label="Terminé" variant="primary" onPress={() => router.back()} />}>
        <View style={styles.block}>
          <ThemedText type="title" accessibilityRole="header">
            Nouveau coffre actif
          </ThemedText>
          <ThemedText>
            {report.notes} note(s), {report.categories} catégorie(s) et {report.blobs} image(s) ou
            fichier(s) recopiés dans le nouveau coffre. L&apos;ancienne base de cet appareil est
            effacée.
          </ThemedText>
          {config.enabled && (
            <Notice tone="info" title="Vos autres appareils">
              Supprimez-y le coffre, puis restaurez-le avec la nouvelle phrase.
            </Notice>
          )}
        </View>
        <RetirementNotice />
      </Screen>
    );
  }

  const start = async () => {
    const confirmed = await confirmDestructive({
      title: 'Recréer le coffre ?',
      message: config.enabled
        ? "L'ancienne phrase ne servira plus à rien et l'ancien compte sera vidé puis fermé sur le serveur. Vos autres appareils devront être restaurés avec la nouvelle phrase."
        : "L'ancienne phrase ne servira plus à rien : seule la nouvelle permettra de retrouver vos notes.",
      confirmLabel: 'Continuer',
    });
    if (confirmed) setStep('phrase');
  };

  return (
    <Screen footer={<Button label="Continuer" variant="danger" disabled={blocked} onPress={start} />}>
      <View style={styles.block}>
        <ThemedText type="title" accessibilityRole="header">
          Recréer le coffre
        </ThemedText>
        <ThemedText>
          Si vous avez perdu votre phrase de récupération, ou si quelqu&apos;un a pu la voir : l&apos;app
          crée une nouvelle phrase et un nouveau coffre, y recopie toutes vos notes, catégories,
          images et fichiers joints, puis efface l&apos;ancien.
        </ThemedText>
        {config.enabled ? (
          <>
            <ThemedText>
              Vos notes sont envoyées au nouveau compte ; une fois tout reçu, l&apos;ancien compte est
              vidé et fermé. Vos liens de partage continuent de fonctionner.
            </ThemedText>
            <Notice tone="warning" title="Vos autres appareils cesseront de se synchroniser">
              Il faudra y restaurer le coffre avec la nouvelle phrase. Ce qu&apos;ils n&apos;ont pas
              encore envoyé sera perdu.
            </Notice>
          </>
        ) : (
          <ThemedText themeColor="inkMuted">
            La synchronisation est désactivée : rien n&apos;est envoyé ni supprimé sur un serveur.
          </ThemedText>
        )}
        <Notice tone="info" title="Conseillé avant de commencer">
          Réglages → Export → « Exporter toutes les notes ».
        </Notice>
      </View>
      {unfinished && <RetirementNotice />}
      {missing !== null && missing > 0 && (
        <Notice tone="danger" title="Fichiers pas encore sur cet appareil">
          {missing} image(s) ou fichier(s) joint(s) manquent. Attendez la fin de la synchronisation :
          ils seraient perdus.
        </Notice>
      )}
      {pendingSync && !blocked && (
        <ThemedText themeColor="inkMuted" type="callout">
          Synchronisation en cours : les dernières modifications des autres appareils arriveront
          peut-être après la copie.
        </ThemedText>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.three },
});
