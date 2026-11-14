import { useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Copy, Eye, EyeOff } from 'lucide-react-native';

import { Button } from '@/components/button';
import { Notice } from '@/components/notice';
import { Screen } from '@/components/screen';
import { ScreenCaptureGuard } from '@/components/screen-capture-guard';
import { SecretTextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
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
  const [masked, setMasked] = useState(false);

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
      <Screen footer={<Button label="Afficher les 24 mots" variant="primary" onPress={reveal} />}>
        {intro}
      </Screen>
    );
  }

  if (step === 'reveal') {
    return (
      <Screen
        footer={<Button label="J’ai noté les 24 mots" variant="primary" onPress={() => setStep('verify')} />}>
        <ScreenCaptureGuard />
        <ThemedText type="title" accessibilityRole="header">
          Votre phrase de récupération
        </ThemedText>
        <Notice tone="warning" title="Notez ces 24 mots maintenant">
          Dans l&apos;ordre, sur papier. Ils ne seront plus jamais affichés.
          {Platform.OS !== 'web' && ' Les captures d’écran sont bloquées.'}
        </Notice>
        <View style={styles.phrase}>
          <View style={styles.grid}>
            {draft.words.map((word, index) => (
              <ThemedView key={index} type="surfaceSunken" style={styles.word}>
                <ThemedText type="caption" themeColor="inkSubtle" style={styles.index}>
                  {String(index + 1).padStart(2, '0')}
                </ThemedText>
                <ThemedText
                  type="phrase"
                  themeColor={masked ? 'inkSubtle' : 'ink'}
                  selectable={false}
                  numberOfLines={1}
                  style={styles.flex}>
                  {masked ? '••••••' : word}
                </ThemedText>
              </ThemedView>
            ))}
          </View>
          <View style={styles.actions}>
            <Button
              size="sm"
              variant="ghost"
              icon={masked ? Eye : EyeOff}
              label={masked ? 'Afficher' : 'Masquer'}
              onPress={() => setMasked((value) => !value)}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={Copy}
              label={`Copier (${SECRET_CLIPBOARD_SECONDS} s)`}
              onPress={async () => {
                await copySecret(draft.words.join(' '));
                setCopied(true);
              }}
            />
          </View>
          <ThemedText type="caption" themeColor={copied ? 'success' : 'inkSubtle'}>
            {copied
              ? `Copié. Le presse-papiers sera vidé dans ${SECRET_CLIPBOARD_SECONDS} secondes.`
              : `La copie est effacée du presse-papiers après ${SECRET_CLIPBOARD_SECONDS} secondes. Le papier reste plus sûr.`}
          </ThemedText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <View style={styles.block}>
          <Button
            label={busy ? 'Un instant…' : confirmLabel}
            variant="primary"
            disabled={busy || answers.some((answer) => answer.trim() === '')}
            onPress={confirm}
          />
          <Button
            label="Revoir les 24 mots"
            variant="ghost"
            disabled={busy}
            onPress={() => {
              setError(null);
              setStep('reveal');
            }}
          />
        </View>
      }>
      <ScreenCaptureGuard />
      <View style={styles.block}>
        <ThemedText type="title" accessibilityRole="header">
          Vérification
        </ThemedText>
        <ThemedText themeColor="inkMuted">Saisissez les mots demandés à partir de votre copie.</ThemedText>
      </View>
      <View style={styles.fields}>
        {draft.challenge.map((position, index) => (
          <SecretTextField
            key={position}
            label={`Mot n° ${position + 1}`}
            accessibilityLabel={`Mot numéro ${position + 1}`}
            value={answers[index]}
            invalid={error !== null}
            onChangeText={(text) => {
              setError(null);
              setAnswers((current) => current.map((v, i) => (i === index ? text : v)));
            }}
          />
        ))}
        {error && <Notice tone="danger">{error}</Notice>}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  fields: { gap: Spacing.three },
  phrase: { gap: Spacing.two },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  word: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.sm,
    // Trois colonnes.
    width: '31.5%',
    flexGrow: 1,
  },
  index: { minWidth: 16 },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: Spacing.two },
});
