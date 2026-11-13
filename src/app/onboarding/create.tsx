import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { ScreenCaptureGuard } from '@/components/screen-capture-guard';
import { SecretTextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { cryptoReady } from '@/crypto/aead';
import { entropyToWords, generateEntropy, normalizeWord, WORD_COUNT } from '@/crypto/mnemonic';
import { copySecret, SECRET_CLIPBOARD_SECONDS } from '@/security/secret-clipboard';
import { useVault } from '@/vault/vault-context';

const VERIFIED_WORDS = 3;

type Draft = {
  entropy: Uint8Array;
  words: string[];
  /** Positions (à partir de 0) des mots à ressaisir, triées. */
  challenge: number[];
};

function pickPositions(): number[] {
  const positions = new Set<number>();
  while (positions.size < VERIFIED_WORDS) {
    positions.add(Math.floor(Math.random() * WORD_COUNT));
  }
  return [...positions].sort((a, b) => a - b);
}

export default function CreateVaultScreen() {
  const { openWithEntropy } = useVault();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState<'intro' | 'reveal' | 'verify'>('intro');
  const [answers, setAnswers] = useState<string[]>(Array(VERIFIED_WORDS).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const reveal = async () => {
    await cryptoReady();
    const entropy = generateEntropy();
    setDraft({ entropy, words: entropyToWords(entropy), challenge: pickPositions() });
    setStep('reveal');
  };

  const confirm = async () => {
    if (!draft) return;
    const correct = draft.challenge.every(
      (position, index) => normalizeWord(answers[index]) === draft.words[position],
    );
    if (!correct) {
      setError('Au moins un mot ne correspond pas. Vérifiez votre copie de la phrase.');
      return;
    }
    setBusy(true);
    try {
      // Dès que le coffre est ouvert, cet écran disparaît : la phrase n'existe
      // plus nulle part dans l'app.
      await openWithEntropy(draft.entropy);
      draft.entropy.fill(0);
    } catch (cause) {
      setBusy(false);
      setError(`Le coffre n'a pas pu être enregistré : ${String(cause)}`);
    }
  };

  if (step === 'intro' || !draft) {
    return (
      <Screen>
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
        <Button label="Afficher les 24 mots" variant="primary" onPress={reveal} />
      </Screen>
    );
  }

  if (step === 'reveal') {
    return (
      <Screen>
        <ScreenCaptureGuard />
        <View style={styles.block}>
          <ThemedText type="title">Notez ces 24 mots</ThemedText>
          <ThemedText themeColor="textSecondary">
            Dans l&apos;ordre, sur papier.
            {Platform.OS !== 'web' && ' Les captures d’écran sont bloquées.'}
          </ThemedText>
        </View>
        <View style={styles.grid}>
          {draft.words.map((word, index) => (
            <ThemedView key={index} type="backgroundElement" style={styles.word}>
              <ThemedText themeColor="textSecondary" type="small" style={styles.index}>
                {index + 1}
              </ThemedText>
              <ThemedText selectable={false}>{word}</ThemedText>
            </ThemedView>
          ))}
        </View>
        <View style={styles.block}>
          <Button label="Je les ai notés" variant="primary" onPress={() => setStep('verify')} />
          <Button
            label="Copier dans le presse-papiers"
            onPress={async () => {
              await copySecret(draft.words.join(' '));
              setCopied(true);
            }}
          />
          <ThemedText type="small" themeColor={copied ? 'success' : 'textSecondary'}>
            {copied
              ? `Copié. Le presse-papiers sera vidé dans ${SECRET_CLIPBOARD_SECONDS} secondes.`
              : `La copie est effacée du presse-papiers après ${SECRET_CLIPBOARD_SECONDS} secondes. Le papier reste plus sûr.`}
          </ThemedText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenCaptureGuard />
      <View style={styles.block}>
        <ThemedText type="title">Vérification</ThemedText>
        <ThemedText themeColor="textSecondary">
          Saisissez les mots demandés à partir de votre copie.
        </ThemedText>
      </View>
      <View style={styles.block}>
        {draft.challenge.map((position, index) => (
          <View key={position} style={styles.block}>
            <ThemedText type="small">Mot n° {position + 1}</ThemedText>
            <SecretTextField
              accessibilityLabel={`Mot numéro ${position + 1}`}
              value={answers[index]}
              onChangeText={(text) => {
                setError(null);
                setAnswers((current) => current.map((v, i) => (i === index ? text : v)));
              }}
            />
          </View>
        ))}
        {error && <ThemedText themeColor="danger">{error}</ThemedText>}
      </View>
      <View style={styles.block}>
        <Button
          label="Créer le coffre"
          variant="primary"
          disabled={busy || answers.some((answer) => answer.trim() === '')}
          onPress={confirm}
        />
        <Button
          label="Revoir les 24 mots"
          disabled={busy}
          onPress={() => {
            setError(null);
            setStep('reveal');
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  word: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two + Spacing.one,
    borderRadius: 8,
    width: '48%',
    flexGrow: 1,
  },
  index: { minWidth: 20, textAlign: 'right' },
});
