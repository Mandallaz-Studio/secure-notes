import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Notice } from '@/components/notice';
import { Screen } from '@/components/screen';
import { ScreenCaptureGuard } from '@/components/screen-capture-guard';
import { SecretTextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { cryptoReady } from '@/crypto/aead';
import { MnemonicError, splitWords, WORD_COUNT, wordsToEntropy } from '@/crypto/mnemonic';
import { clearClipboardIfContains } from '@/security/secret-clipboard';
import { useVault } from '@/vault/vault-context';

function describe(error: unknown, words: string[]): string {
  if (!(error instanceof MnemonicError)) {
    return `Le coffre n'a pas pu être restauré : ${String(error)}`;
  }
  switch (error.reason) {
    case 'word-count':
      return `La phrase doit compter ${WORD_COUNT} mots ; vous en avez saisi ${words.length}.`;
    case 'unknown-word':
      return `Mots non reconnus : ${error.positions
        .map((position) => `n° ${position + 1} (« ${words[position]} »)`)
        .join(', ')}.`;
    case 'checksum':
      return 'Tous les mots existent, mais la phrase est incorrecte : vérifiez leur ordre et leur orthographe.';
  }
}

export default function RestoreVaultScreen() {
  const { openWithEntropy } = useVault();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const words = splitWords(input);

  const restore = async () => {
    setBusy(true);
    try {
      await cryptoReady();
      const entropy = wordsToEntropy(words);
      // Si la phrase a été collée, elle ne doit pas traîner dans le presse-papiers.
      await clearClipboardIfContains(input);
      await openWithEntropy(entropy);
      entropy.fill(0);
    } catch (cause) {
      setBusy(false);
      setError(describe(cause, words));
    }
  };

  return (
    <Screen>
      <ScreenCaptureGuard />
      <View style={styles.block}>
        <ThemedText type="title" accessibilityRole="header">
          Restaurer un coffre
        </ThemedText>
        <ThemedText themeColor="inkMuted">
          Saisissez vos 24 mots dans l&apos;ordre, séparés par des espaces. Les accents et les
          majuscules sont facultatifs.
        </ThemedText>
      </View>
      <View style={styles.block}>
        <SecretTextField
          accessibilityLabel="Phrase de récupération"
          multiline
          value={input}
          invalid={error !== null}
          onChangeText={(text) => {
            setError(null);
            setInput(text);
          }}
          style={styles.input}
        />
        <ThemedText type="caption" themeColor="inkSubtle">
          {words.length} / {WORD_COUNT} mots
        </ThemedText>
        {error && <Notice tone="danger">{error}</Notice>}
      </View>
      <Button
        label="Restaurer"
        variant="primary"
        disabled={busy || words.length === 0}
        onPress={restore}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  input: { minHeight: 140, textAlignVertical: 'top' },
});
