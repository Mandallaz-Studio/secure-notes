import { useState, type ReactNode } from 'react';
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

type NewPhraseFlowProps = {
  /** Premier écran, avant l'affichage des mots ; il finit par le bouton qui les affiche. */
  intro: ReactNode;
  /** Bouton final, après la vérification des mots. */
  confirmLabel: string;
  /** Début du message d'erreur si `onConfirmed` échoue. */
  failure: string;
  /**
   * Reçoit l'entropie de la phrase, vérifiée. Si elle réussit, l'écran doit
   * disparaître : la phrase n'existe alors plus nulle part dans l'app.
   */
  onConfirmed: (entropy: Uint8Array) => Promise<void>;
};

/**
 * Création d'une phrase de récupération : affichage unique des 24 mots, puis
 * ressaisie de quelques-uns. Sert à créer un coffre et à le recréer.
 */
export function NewPhraseFlow({ intro, confirmLabel, failure, onConfirmed }: NewPhraseFlowProps) {
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
      await onConfirmed(draft.entropy);
      draft.entropy.fill(0);
    } catch (cause) {
      setBusy(false);
      setError(`${failure} : ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  if (step === 'intro' || !draft) {
    return (
      <Screen>
        {intro}
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
          label={busy ? 'Un instant…' : confirmLabel}
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
