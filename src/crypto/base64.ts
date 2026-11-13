/**
 * Base64 standard (avec remplissage), tel que l'attendent les adresses `data:`.
 * La variante « URL » de libsodium (`toBase64` de `aead.ts`) reste celle des
 * données envoyées au serveur.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VALUES = new Uint8Array(128).fill(255);
for (let i = 0; i < ALPHABET.length; i++) VALUES[ALPHABET.charCodeAt(i)] = i;

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    chunk +=
      ALPHABET[a >> 2] +
      ALPHABET[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? ALPHABET[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < bytes.length ? ALPHABET[c & 63] : '=');
    if (chunk.length >= 16384) {
      parts.push(chunk);
      chunk = '';
    }
  }
  parts.push(chunk);
  return parts.join('');
}

/** @throws si le texte n'est pas du base64 standard. */
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  if (clean.length % 4 === 1) throw new Error('Base64 invalide');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let out = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const value = code < 128 ? VALUES[code] : 255;
    if (value === 255) throw new Error('Base64 invalide');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out++] = (buffer >> bits) & 255;
    }
  }
  return bytes;
}
