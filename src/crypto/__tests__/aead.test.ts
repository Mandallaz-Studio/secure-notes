import {
  cryptoReady,
  decrypt,
  deriveSubkey,
  encrypt,
  generateKey,
  KEY_BYTES,
  NONCE_BYTES,
  TAG_BYTES,
  utf8Decode,
  utf8Encode,
} from '@/crypto/aead';
import { fromHex, REFERENCE, toHex } from '@/crypto/vectors';

beforeAll(async () => {
  await cryptoReady();
});

describe('encrypt / decrypt', () => {
  it('restitue le texte en clair', () => {
    const key = generateKey();
    const message = 'Note secrète — accents éàü et emoji 🔐';
    const sealed = encrypt(utf8Encode(message), key);

    expect(sealed.length).toBe(NONCE_BYTES + utf8Encode(message).length + TAG_BYTES);
    expect(utf8Decode(decrypt(sealed, key))).toBe(message);
  });

  it('produit un chiffré différent à chaque appel', () => {
    const key = generateKey();
    const plaintext = utf8Encode('même message');

    expect(encrypt(plaintext, key)).not.toEqual(encrypt(plaintext, key));
  });

  it('refuse une mauvaise clé', () => {
    const sealed = encrypt(utf8Encode('secret'), generateKey());

    expect(() => decrypt(sealed, generateKey())).toThrow();
  });

  it('refuse un message altéré', () => {
    const key = generateKey();
    const sealed = encrypt(utf8Encode('secret'), key);
    sealed[sealed.length - 1] ^= 1;

    expect(() => decrypt(sealed, key)).toThrow();
  });

  it('lie le message aux données associées', () => {
    const key = generateKey();
    const sealed = encrypt(utf8Encode('secret'), key, 'note-1');

    expect(utf8Decode(decrypt(sealed, key, 'note-1'))).toBe('secret');
    expect(() => decrypt(sealed, key, 'note-2')).toThrow();
    expect(() => decrypt(sealed, key)).toThrow();
  });

  it('refuse une clé de mauvaise longueur et un message tronqué', () => {
    expect(() => encrypt(utf8Encode('x'), new Uint8Array(16))).toThrow(/Clé invalide/);
    expect(() => decrypt(new Uint8Array(10), generateKey())).toThrow(/trop court/);
  });
});

describe('deriveSubkey', () => {
  it('est déterministe et sépare les usages', () => {
    const master = new Uint8Array(KEY_BYTES).fill(7);
    const a = deriveSubkey(master, 'snotes01', 1);

    expect(a.length).toBe(KEY_BYTES);
    expect(deriveSubkey(master, 'snotes01', 1)).toEqual(a);
    expect(deriveSubkey(master, 'snotes01', 2)).not.toEqual(a);
    expect(deriveSubkey(master, 'snotes02', 1)).not.toEqual(a);
  });

  it('donne la sous-clé de référence', () => {
    const subkey = deriveSubkey(REFERENCE.masterKey, REFERENCE.context, REFERENCE.subkeyId);

    expect(toHex(subkey)).toBe(REFERENCE.subkeyHex);
  });

  it('déchiffre le message de référence', () => {
    const subkey = deriveSubkey(REFERENCE.masterKey, REFERENCE.context, REFERENCE.subkeyId);
    const plaintext = decrypt(fromHex(REFERENCE.sealedHex), subkey, REFERENCE.associatedData);

    expect(utf8Decode(plaintext)).toBe(REFERENCE.plaintext);
  });
});
