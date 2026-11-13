import sodium from 'react-native-libsodium';

/**
 * Chiffrement authentifié XChaCha20-Poly1305 (clé de 256 bits).
 *
 * Format d'un message chiffré : nonce (24 octets) || texte chiffré || tag (16 octets).
 * Le nonce est aléatoire : avec 192 bits, le risque de collision est négligeable.
 */

// Sur le web, la dérivation de clés n'existe que dans la variante complète
// (« sumo ») de libsodium ; à demander avant le chargement. Sans effet sur mobile.
sodium.loadSumoVersion?.();

export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const TAG_BYTES = 16;

/** À attendre une fois avant tout appel (chargement du module natif ou WebAssembly). */
export function cryptoReady(): Promise<void> {
  return sodium.ready;
}

export function generateKey(): Uint8Array {
  return sodium.randombytes_buf(KEY_BYTES);
}

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Clé invalide : ${KEY_BYTES} octets attendus, ${key.length} reçus`);
  }
}

/**
 * @param associatedData Données authentifiées mais non chiffrées (identifiant de
 *   la note, par exemple) : le déchiffrement échoue si elles diffèrent. En texte,
 *   car la version native de libsodium n'accepte pas d'octets à cet endroit.
 */
export function encrypt(plaintext: Uint8Array, key: Uint8Array, associatedData = ''): Uint8Array {
  assertKey(key);
  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    associatedData,
    null,
    nonce,
    key,
  );
  const sealed = new Uint8Array(NONCE_BYTES + ciphertext.length);
  sealed.set(nonce, 0);
  sealed.set(ciphertext, NONCE_BYTES);
  return sealed;
}

/** Lève une erreur si la clé est mauvaise ou si le message a été altéré. */
export function decrypt(sealed: Uint8Array, key: Uint8Array, associatedData = ''): Uint8Array {
  assertKey(key);
  if (sealed.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error('Message chiffré trop court');
  }
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    sealed.subarray(NONCE_BYTES),
    associatedData,
    sealed.subarray(0, NONCE_BYTES),
    key,
  );
}

/**
 * Dérive une sous-clé de 256 bits (BLAKE2b, `crypto_kdf` de libsodium).
 * @param context Exactement 8 caractères ASCII, propre à chaque usage.
 */
export function deriveSubkey(masterKey: Uint8Array, context: string, id: number): Uint8Array {
  assertKey(masterKey);
  if (context.length !== 8) {
    throw new Error('Le contexte de dérivation doit faire exactement 8 caractères');
  }
  return sodium.crypto_kdf_derive_from_key(KEY_BYTES, id, context, masterKey);
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return sodium.to_string(bytes);
}

export function toBase64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes);
}
