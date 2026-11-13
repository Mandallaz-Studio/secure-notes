/**
 * Valeurs de référence à entrées fixes, produites sous Node avec
 * libsodium-wrappers. Elles servent à vérifier que chaque plateforme (Android,
 * iOS, web) dérive les mêmes clés et lit les mêmes messages : une divergence
 * rendrait les notes illisibles d'un appareil à l'autre.
 */
export const REFERENCE = {
  /** Clé maîtresse : octets 00..1f. */
  masterKey: Uint8Array.from({ length: 32 }, (_, i) => i),
  context: 'KDF test',
  subkeyId: 0,
  /** Sous-clé attendue, recoupée avec le BLAKE2b de @noble/hashes. */
  subkeyHex: 'c13fcc2e6cd0cd0f82d93b163a5696c5105378f8c629d36baf3ae0239de9c280',
  associatedData: 'note-1',
  plaintext: 'Compatibilité éàü 🔐',
  /** Message chiffré avec la sous-clé ci-dessus et les données associées. */
  sealedHex:
    'fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0efeeedecebeae9e8d1a0d05387c32586c2e73b4385dc7511f9da194e727cf0d06762a98c63f77a4797e1e625654b3f855323',
} as const;

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  return Uint8Array.from({ length: hex.length / 2 }, (_, i) =>
    parseInt(hex.slice(i * 2, i * 2 + 2), 16),
  );
}
