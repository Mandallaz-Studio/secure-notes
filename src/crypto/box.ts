import sodium from 'react-native-libsodium';

/**
 * Boîte scellée (`crypto_box_seal` de libsodium : X25519, XSalsa20-Poly1305).
 *
 * Seul usage de la cryptographie asymétrique dans l'app : l'envoi d'un lien par
 * QR code (`src/share/handoff.ts`), où elle s'ajoute au chiffrement symétrique
 * sans le remplacer. La confidentialité tient tant que l'une des deux couches
 * tient : un ordinateur quantique ne lit rien sans le secret du QR code, et
 * qui photographie le QR code ne lit rien sans la clé privée de l'afficheur.
 */

export const BOX_PUBLIC_KEY_BYTES = 32;

export type BoxKeyPair = { publicKey: Uint8Array; privateKey: Uint8Array };

export function newBoxKeyPair(): BoxKeyPair {
  const pair = sodium.crypto_box_keypair();
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

/** Chiffre pour le seul détenteur de la clé privée ; l'expéditeur reste anonyme. */
export function sealTo(message: Uint8Array, publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== BOX_PUBLIC_KEY_BYTES) throw new Error('Clé publique invalide');
  return sodium.crypto_box_seal(message, publicKey);
}

/** Lève une erreur si le message n'est pas pour cette paire de clés, ou a été altéré. */
export function openSealed(sealed: Uint8Array, pair: BoxKeyPair): Uint8Array {
  return sodium.crypto_box_seal_open(sealed, pair.publicKey, pair.privateKey);
}
