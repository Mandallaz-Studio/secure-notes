import {
  decrypt,
  encrypt,
  fromBase64,
  generateKey,
  NONCE_BYTES,
  TAG_BYTES,
  toBase64,
} from '@/crypto/aead';

/**
 * Chiffrement d'un fichier par blocs.
 *
 * Le fichier reçoit une clé aléatoire, chiffrée par la clé d'enveloppe du
 * compte. Il est découpé en blocs de 256 Kio, chiffrés un par un avec cette
 * clé (la version native de libsodium n'expose pas `secretstream`).
 *
 * Chaque bloc authentifie l'identifiant du fichier, son rang et le nombre
 * total de blocs : le serveur ne peut ni échanger deux blocs, ni présenter un
 * bloc d'un autre fichier, ni tronquer le fichier sans que ce soit détecté.
 *
 * Ces formats et contextes font partie des données stockées : ne pas les changer.
 */

export const CHUNK_BYTES = 256 * 1024;

const keyContext = (id: string) => `sn1:blobkey:${id}`;
const chunkContext = (id: string, index: number, total: number) =>
  `sn1:blob:${id}:${index}:${total}`;

/** Nombre de blocs d'un fichier ; un fichier vide en a un, vide. */
export function chunkCountOf(size: number): number {
  return Math.max(1, Math.ceil(size / CHUNK_BYTES));
}

export function newFileKey(): Uint8Array {
  return generateKey();
}

export function wrapFileKey(id: string, fileKey: Uint8Array, wrapKey: Uint8Array): string {
  return toBase64(encrypt(fileKey, wrapKey, keyContext(id)));
}

/** @throws si la clé n'appartient pas à ce fichier ou à ce compte. */
export function unwrapFileKey(id: string, wrapped: string, wrapKey: Uint8Array): Uint8Array {
  return decrypt(fromBase64(wrapped), wrapKey, keyContext(id));
}

/** Taille totale des blocs chiffrés d'un fichier de `size` octets. */
export function sealedSizeOf(size: number): number {
  return size + chunkCountOf(size) * (NONCE_BYTES + TAG_BYTES);
}

/** Bloc de rang `index` du fichier `data`, chiffré. */
export function sealChunk(
  id: string,
  data: Uint8Array,
  index: number,
  fileKey: Uint8Array,
): Uint8Array {
  const total = chunkCountOf(data.length);
  const slice = data.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
  return encrypt(slice, fileKey, chunkContext(id, index, total));
}

/** @throws si le bloc a été altéré, déplacé, ou vient d'un autre fichier. */
export function openChunk(
  id: string,
  sealed: Uint8Array,
  index: number,
  total: number,
  fileKey: Uint8Array,
): Uint8Array {
  return decrypt(sealed, fileKey, chunkContext(id, index, total));
}

/** Recolle les blocs déchiffrés d'un fichier. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const data = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return data;
}
