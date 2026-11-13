import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/french.js';
import sodium from 'react-native-libsodium';

/**
 * Phrase de récupération : 24 mots de la liste BIP39 française, soit 256 bits
 * d'entropie plus 8 bits de somme de contrôle.
 *
 * La phrase n'est jamais stockée. Seule la clé maîtresse, dérivée à sens unique
 * de l'entropie (voir `keys.ts`), est conservée sur l'appareil.
 */

export const WORD_COUNT = 24;
export const ENTROPY_BYTES = 32;

export type MnemonicErrorReason = 'word-count' | 'unknown-word' | 'checksum';

export class MnemonicError extends Error {
  constructor(
    readonly reason: MnemonicErrorReason,
    /** Positions (à partir de 0) des mots inconnus, pour `unknown-word`. */
    readonly positions: number[] = [],
  ) {
    super(`Phrase de récupération invalide : ${reason}`);
    this.name = 'MnemonicError';
  }
}

/** Minuscules, sans accents : la liste française reste sans doublon ainsi. */
function fold(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// La liste est fournie en forme décomposée (NFKD) ; on affiche et compare en NFC.
const canonicalByFolded = new Map(wordlist.map((word) => [fold(word), word.normalize('NFC')]));

/**
 * Retrouve le mot officiel à partir d'une saisie, en tolérant majuscules et
 * accents manquants (« ecole » pour « école »). `null` si le mot n'existe pas.
 */
export function normalizeWord(input: string): string | null {
  return canonicalByFolded.get(fold(input)) ?? null;
}

/** Découpe une saisie libre (espaces, retours à la ligne, virgules) en mots. */
export function splitWords(input: string): string[] {
  return input.split(/[\s,;]+/).filter(Boolean);
}

export function generateEntropy(): Uint8Array {
  return sodium.randombytes_buf(ENTROPY_BYTES);
}

export function entropyToWords(entropy: Uint8Array): string[] {
  if (entropy.length !== ENTROPY_BYTES) {
    throw new Error(`Entropie invalide : ${ENTROPY_BYTES} octets attendus`);
  }
  return entropyToMnemonic(entropy, wordlist)
    .split(' ')
    .map((word) => word.normalize('NFC'));
}

/** @throws {MnemonicError} si la phrase est incomplète, mal orthographiée ou erronée. */
export function wordsToEntropy(words: string[]): Uint8Array {
  if (words.length !== WORD_COUNT) {
    throw new MnemonicError('word-count');
  }
  const canonical = words.map(normalizeWord);
  const unknown = canonical.flatMap((word, index) => (word === null ? [index] : []));
  if (unknown.length > 0) {
    throw new MnemonicError('unknown-word', unknown);
  }
  try {
    return mnemonicToEntropy(canonical.join(' '), wordlist);
  } catch {
    // Tous les mots existent : seule la somme de contrôle peut encore échouer.
    throw new MnemonicError('checksum');
  }
}
