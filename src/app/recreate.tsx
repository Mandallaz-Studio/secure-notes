import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { confirmDestructive } from '@/components/confirm';
import { NewPhraseFlow } from '@/components/new-phrase';
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
            <ThemedText type="title">Votre nouvelle phrase</ThemedText>
            <ThemedText>
              L&apos;app va afficher 24 nouveaux mots. Ils remplacent l&apos;ancienne phrase, qui ne
              permettra plus de retrouver vos notes.
            </ThemedText>
            <ThemedText themeColor="danger">
              Ils ne seront affichés qu&apos;une seule fois. Notez-les sur papier, dans l&apos;ordre,
              et gardez-les en lieu sûr.
            </ThemedText>
          </View>
        }
      />
    );
  }

  if (step === 'done' && report) {
    return (
      <Screen>
        <View style={styles.block}>
          <ThemedText type="title">Nouveau coffre actif</ThemedText>
          <ThemedText>
            {report.notes} note(s), {report.categories} catégorie(s) et {report.blobs} image(s) ou
            fichier(s) recopiés dans le nouveau coffre. L&apos;ancienne base de cet appareil est
            effacée.
          </ThemedText>
          {config.enabled && (
            <ThemedText themeColor="textSecondary">
              Sur vos autres appareils, supprimez le coffre puis restaurez-le avec la nouvelle
              phrase.
            </ThemedText>
          )}
        </View>
        <RetirementNotice />
        <Button label="Terminé" variant="primary" onPress={() => router.back()} />
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
    <Screen>
      <View style={styles.block}>
        <ThemedText type="title">Recréer le coffre</ThemedText>
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
            <ThemedText themeColor="danger">
              Vos autres appareils cesseront de se synchroniser : il faudra y restaurer le coffre
              avec la nouvelle phrase. Ce qu&apos;ils n&apos;ont pas encore envoyé sera perdu.
            </ThemedText>
          </>
        ) : (
          <ThemedText themeColor="textSecondary">
            La synchronisation est désactivée : rien n&apos;est envoyé ni supprimé sur un serveur.
          </ThemedText>
        )}
        <ThemedText themeColor="textSecondary">
          Conseillé avant de commencer : Réglages → Export → « Exporter toutes les notes ».
        </ThemedText>
      </View>
      {unfinished && <RetirementNotice />}
      {missing !== null && missing > 0 && (
        <ThemedText themeColor="danger">
          {missing} image(s) ou fichier(s) joint(s) ne sont pas encore sur cet appareil. Attendez la
          fin de la synchronisation : ils seraient perdus.
        </ThemedText>
      )}
      {pendingSync && !blocked && (
        <ThemedText themeColor="textSecondary" type="small">
          Synchronisation en cours : les dernières modifications des autres appareils arriveront
          peut-être après la copie.
        </ThemedText>
      )}
      <Button label="Continuer" variant="danger" disabled={blocked} onPress={start} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
});
