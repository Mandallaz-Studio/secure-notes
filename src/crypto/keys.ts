import { deriveSubkey, KEY_BYTES, toBase64 } from '@/crypto/aead';
import { ENTROPY_BYTES } from '@/crypto/mnemonic';
import { toHex } from '@/crypto/vectors';

/**
 * Hiérarchie des clés.
 *
 *   phrase (24 mots) → entropie (256 bits) → clé maîtresse → sous-clés par usage
 *
 * Chaque flèche est une dérivation BLAKE2b à sens unique (`crypto_kdf` de
 * libsodium) : connaître une sous-clé ne révèle ni la clé maîtresse ni les
 * autres sous-clés, et la clé maîtresse ne permet pas de retrouver la phrase.
 *
 * Les contextes ci-dessous font partie du format des données : les changer
 * rendrait illisibles tous les coffres existants.
 */
const CONTEXT = {
  master: 'snmaster',
  accountId: 'snacctid',
  authSecret: 'snauthpw',
  wrapKey: 'snwrapky',
  databaseKey: 'snlocldb',
} as const;

const VERSION = 1;

export type VaultKeys = {
  /** Identifiant public du compte (32 caractères hexadécimaux). */
  accountId: string;
  /** Mot de passe du compte de synchronisation, jamais utilisé pour chiffrer. */
  authSecret: string;
  /** Chiffre les clés propres à chaque note et à chaque fichier. */
  wrapKey: Uint8Array;
  /** Chiffre la base de données locale. */
  databaseKey: Uint8Array;
};

export function masterKeyFromEntropy(entropy: Uint8Array): Uint8Array {
  if (entropy.length !== ENTROPY_BYTES) {
    throw new Error(`Entropie invalide : ${ENTROPY_BYTES} octets attendus`);
  }
  return deriveSubkey(entropy, CONTEXT.master, VERSION);
}

export function deriveVaultKeys(masterKey: Uint8Array): VaultKeys {
  if (masterKey.length !== KEY_BYTES) {
    throw new Error(`Clé maîtresse invalide : ${KEY_BYTES} octets attendus`);
  }
  return {
    accountId: toHex(deriveSubkey(masterKey, CONTEXT.accountId, VERSION)).slice(0, 32),
    authSecret: toBase64(deriveSubkey(masterKey, CONTEXT.authSecret, VERSION)),
    wrapKey: deriveSubkey(masterKey, CONTEXT.wrapKey, VERSION),
    databaseKey: deriveSubkey(masterKey, CONTEXT.databaseKey, VERSION),
  };
}
