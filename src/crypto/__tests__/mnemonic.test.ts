import { cryptoReady } from '@/crypto/aead';
import { deriveVaultKeys, masterKeyFromEntropy } from '@/crypto/keys';
import {
  entropyToWords,
  generateEntropy,
  MnemonicError,
  normalizeWord,
  splitWords,
  WORD_COUNT,
  wordsToEntropy,
} from '@/crypto/mnemonic';
import { toHex } from '@/crypto/vectors';

beforeAll(async () => {
  await cryptoReady();
});

/** Entropie 00..1f et sa phrase, calculée séparément avec @scure/bip39. */
const ENTROPY = Uint8Array.from({ length: 32 }, (_, i) => i);
const PHRASE =
  'abaisser agréable inductif agréable éligible achat bolide boucle amateur exister dérober bison abrasif justice écharpe inonder avancer piano adulte cobra papaye anonyme hangar tomate';

function reasonOf(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error instanceof MnemonicError ? error.reason : error;
  }
  return 'aucune erreur';
}

describe('phrase de récupération', () => {
  it('produit 24 mots et retrouve la même entropie', () => {
    const entropy = generateEntropy();
    const words = entropyToWords(entropy);

    expect(words).toHaveLength(WORD_COUNT);
    expect(wordsToEntropy(words)).toEqual(entropy);
  });

  it('donne deux phrases différentes pour deux tirages', () => {
    expect(entropyToWords(generateEntropy())).not.toEqual(entropyToWords(generateEntropy()));
  });

  it('correspond à la phrase de référence', () => {
    expect(entropyToWords(ENTROPY).join(' ').normalize('NFC')).toBe(PHRASE);
    expect(toHex(wordsToEntropy(splitWords(PHRASE)))).toBe(toHex(ENTROPY));
  });

  it('tolère majuscules, accents manquants et séparateurs variés', () => {
    const sloppy = PHRASE.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/ /g, ',\n ');

    expect(toHex(wordsToEntropy(splitWords(sloppy)))).toBe(toHex(ENTROPY));
    expect(normalizeWord(' Ecole ')?.normalize('NFC')).toBe('école');
    expect(normalizeWord('ordinateur')).toBeNull();
  });

  it('signale une phrase incomplète', () => {
    expect(reasonOf(() => wordsToEntropy(splitWords(PHRASE).slice(0, 23)))).toBe('word-count');
  });

  it('signale la position des mots inconnus', () => {
    const words = splitWords(PHRASE);
    words[3] = 'ordinateur';
    words[20] = 'xyz';

    try {
      wordsToEntropy(words);
      throw new Error('aurait dû échouer');
    } catch (error) {
      expect(error).toBeInstanceOf(MnemonicError);
      expect((error as MnemonicError).reason).toBe('unknown-word');
      expect((error as MnemonicError).positions).toEqual([3, 20]);
    }
  });

  it('signale une somme de contrôle fausse', () => {
    const words = splitWords(PHRASE);
    [words[0], words[1]] = [words[1], words[0]];

    expect(reasonOf(() => wordsToEntropy(words))).toBe('checksum');
  });
});

describe('dérivation des clés', () => {
  it('est déterministe : la même phrase redonne les mêmes clés', () => {
    const a = deriveVaultKeys(masterKeyFromEntropy(wordsToEntropy(splitWords(PHRASE))));
    const b = deriveVaultKeys(masterKeyFromEntropy(ENTROPY));

    expect(a).toEqual(b);
  });

  it('sépare toutes les clés entre elles et de l’entropie', () => {
    const master = masterKeyFromEntropy(ENTROPY);
    const keys = deriveVaultKeys(master);
    const all = [toHex(ENTROPY), toHex(master), toHex(keys.wrapKey), toHex(keys.databaseKey)];

    expect(new Set(all).size).toBe(all.length);
    expect(keys.accountId).toMatch(/^[0-9a-f]{32}$/);
    expect(all.some((hex) => hex.startsWith(keys.accountId))).toBe(false);
    expect(keys.authSecret.length).toBeGreaterThanOrEqual(43);
  });

  it('garde un format stable d’une version à l’autre', () => {
    // Si ce test casse, les coffres existants deviennent illisibles : ne pas
    // mettre à jour ces valeurs sans migration.
    const master = masterKeyFromEntropy(ENTROPY);
    const keys = deriveVaultKeys(master);

    expect({
      master: toHex(master),
      accountId: keys.accountId,
      authSecret: keys.authSecret,
      wrapKey: toHex(keys.wrapKey),
      databaseKey: toHex(keys.databaseKey),
    }).toMatchSnapshot();
  });

  it('change entièrement pour une autre phrase', () => {
    const other = deriveVaultKeys(masterKeyFromEntropy(generateEntropy()));
    const reference = deriveVaultKeys(masterKeyFromEntropy(ENTROPY));

    expect(other.accountId).not.toBe(reference.accountId);
    expect(other.wrapKey).not.toEqual(reference.wrapKey);
  });

  it('refuse des entrées de mauvaise longueur', () => {
    expect(() => masterKeyFromEntropy(new Uint8Array(16))).toThrow();
    expect(() => deriveVaultKeys(new Uint8Array(16))).toThrow();
  });
});
