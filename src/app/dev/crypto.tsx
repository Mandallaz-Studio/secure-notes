import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  cryptoReady,
  decrypt,
  deriveSubkey,
  encrypt,
  generateKey,
  toBase64,
  utf8Decode,
  utf8Encode,
} from '@/crypto/aead';
import { fromHex, REFERENCE, toHex } from '@/crypto/vectors';
import { useTheme } from '@/hooks/use-theme';

type Result = { ok: boolean; lines: string[] };

const MESSAGE = 'Note secrète — accents éàü et emoji 🔐';

async function runSpike(): Promise<Result> {
  const lines: string[] = [];
  try {
    await cryptoReady();

    const master = generateKey();
    const key = deriveSubkey(master, 'snotes01', 1);
    const sealed = encrypt(utf8Encode(MESSAGE), key);
    const roundTrip = utf8Decode(decrypt(sealed, key));
    lines.push(`Chiffré (${sealed.length} octets) : ${toBase64(sealed).slice(0, 40)}…`);
    lines.push(`Déchiffré : ${roundTrip}`);
    if (roundTrip !== MESSAGE) {
      return { ok: false, lines: [...lines, 'ÉCHEC : le texte déchiffré diffère'] };
    }

    let rejected = false;
    try {
      decrypt(sealed, generateKey());
    } catch {
      rejected = true;
    }
    lines.push(`Mauvaise clé rejetée : ${rejected ? 'oui' : 'NON'}`);
    if (!rejected) {
      return { ok: false, lines };
    }

    // Compatibilité entre plateformes : mêmes clés dérivées, mêmes messages lisibles.
    const refKey = deriveSubkey(REFERENCE.masterKey, REFERENCE.context, REFERENCE.subkeyId);
    const sameKey = toHex(refKey) === REFERENCE.subkeyHex;
    lines.push(`Sous-clé de référence identique : ${sameKey ? 'oui' : 'NON'}`);
    const refText = utf8Decode(
      decrypt(fromHex(REFERENCE.sealedHex), refKey, REFERENCE.associatedData),
    );
    const sameText = refText === REFERENCE.plaintext;
    lines.push(`Message de référence déchiffré : ${sameText ? 'oui' : 'NON'}`);
    if (!sameKey || !sameText) {
      return { ok: false, lines };
    }

    // Débit sur 1 Mo, pour dimensionner le chiffrement des pièces jointes.
    const megabyte = new Uint8Array(1024 * 1024);
    const start = performance.now();
    const sealedMb = encrypt(megabyte, key);
    decrypt(sealedMb, key);
    lines.push(`1 Mo chiffré puis déchiffré en ${Math.round(performance.now() - start)} ms`);

    return { ok: true, lines };
  } catch (error) {
    return { ok: false, lines: [...lines, `ERREUR : ${String(error)}`] };
  }
}

export default function CryptoSpikeScreen() {
  const theme = useTheme();
  const [result, setResult] = useState<Result | null>(null);

  return (
    <ScrollView
      style={{ backgroundColor: theme.surface }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic">
      <ThemedText themeColor="inkMuted" type="callout">
        XChaCha20-Poly1305 avec une sous-clé dérivée, via libsodium.
      </ThemedText>
      <Button label="Lancer l'essai" onPress={async () => setResult(await runSpike())} />
      {result && (
        <>
          <ThemedText type="headline" themeColor={result.ok ? 'success' : 'danger'}>
            {result.ok ? 'Réussi' : 'Échec'}
          </ThemedText>
          {result.lines.map((line) => (
            <ThemedText key={line} type="code" selectable>
              {line}
            </ThemedText>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
});
