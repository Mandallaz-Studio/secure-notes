import {
  cryptoReady,
  decrypt,
  encrypt,
  fromBase64,
  generateKey,
  toBase64,
  utf8Decode,
  utf8Encode,
} from '@/crypto/aead';
import { padJson, padmeLength } from '@/crypto/padding';
import { createNote, withBody, withTitle } from '@/notes/model';
import { isReasonableDoc, openShare, sealShare, sealShareMeta, type SharedNote } from '@/share/codec';
import { openItem, sealDeletion, sealItem } from '@/sync/codec';

beforeAll(async () => {
  await cryptoReady();
});

describe('padmeLength', () => {
  it('arrondit vers le haut avec au plus 12 % de surcoût', () => {
    for (const length of [2, 3, 100, 1000, 1025, 4097, 65_537, 1_000_001, 3_000_000]) {
      const padded = padmeLength(length);
      expect(padded).toBeGreaterThanOrEqual(length);
      expect(padded / length).toBeLessThanOrEqual(1.12);
    }
  });

  it('ramène des longueurs voisines à la même taille', () => {
    expect(padmeLength(10_001)).toBe(padmeLength(10_200));
  });
});

describe('padJson', () => {
  it('complète par des espaces que JSON.parse ignore', () => {
    const json = utf8Encode(JSON.stringify({ a: 'é' }));
    const padded = padJson(json, 64);
    expect(padded).toHaveLength(64);
    expect(JSON.parse(utf8Decode(padded))).toEqual({ a: 'é' });
  });

  it('ne dépasse jamais la limite donnée, ni ne tronque', () => {
    const json = utf8Encode(JSON.stringify('x'.repeat(5000)));
    expect(padJson(json, 0, json.length + 10).length).toBeLessThanOrEqual(json.length + 10);
    expect(padJson(json, 0, 10)).toBe(json);
  });
});

describe('éléments synchronisés', () => {
  let wrapKey: Uint8Array;
  beforeAll(() => {
    wrapKey = generateKey();
  });
  const sizeOf = (ciphertext: string) => fromBase64(ciphertext).length;

  it('donnent la même taille à une suppression, une catégorie et une courte note', () => {
    const note = withBody(withTitle(createNote(1), 'Courses', 1), {
      bodyFormat: 'text',
      body: 'pain, lait',
      plainText: 'pain, lait',
    }, 1);
    const sizes = [
      sizeOf(sealDeletion('11111111-1111-4111-8111-111111111111', wrapKey).ciphertext),
      sizeOf(
        sealItem(
          { kind: 'category', category: { id: 'c', name: 'Perso', createdAt: 1, updatedAt: 1 } },
          wrapKey,
        ).ciphertext,
      ),
      sizeOf(sealItem({ kind: 'note', note }, wrapKey).ciphertext),
    ];
    expect(new Set(sizes).size).toBe(1);
  });

  it('restent lisibles, bourrés ou non', () => {
    const note = createNote(1);
    const sealed = sealItem({ kind: 'note', note }, wrapKey);
    expect(openItem(note.id, sealed, wrapKey)).toEqual({ kind: 'note', note });

    // Élément écrit avant le bourrage : chiffré exactement comme le faisait l'ancien code.
    const { id, ...fields } = note;
    const itemKey = generateKey();
    const legacy = {
      wrappedKey: toBase64(encrypt(itemKey, wrapKey, `sn1:key:${id}`)),
      ciphertext: toBase64(
        encrypt(utf8Encode(JSON.stringify({ v: 1, t: 'note', ...fields })), itemKey, `sn1:item:${id}`),
      ),
    };
    expect(fromBase64(legacy.ciphertext).length).toBeLessThan(1024);
    expect(openItem(id, legacy, wrapKey)).toEqual({ kind: 'note', note });
  });

  it('se lisent par une version qui ne connaît pas le bourrage', () => {
    // L'ancien code déchiffre puis fait `JSON.parse` : les espaces ajoutés sont ignorés.
    const note = createNote(1);
    const sealed = sealItem({ kind: 'note', note }, wrapKey);
    const itemKey = decrypt(fromBase64(sealed.wrappedKey), wrapKey, `sn1:key:${note.id}`);
    const plain = utf8Decode(decrypt(fromBase64(sealed.ciphertext), itemKey, `sn1:item:${note.id}`));
    expect(plain.endsWith(' ')).toBe(true);
    expect(JSON.parse(plain)).toMatchObject({ v: 1, t: 'note', title: note.title });
  });
});

describe('partages', () => {
  const id = '22222222-2222-4222-8222-222222222222';
  const shared: SharedNote = {
    v: 1,
    title: 'Titre',
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bonjour' }] }] },
    sharedAt: 1,
  };

  it('bourre la copie et les métadonnées', () => {
    const key = generateKey();
    const sealed = sealShare(id, shared, key);
    expect(fromBase64(sealed).length).toBeGreaterThanOrEqual(1024);
    expect(openShare(id, sealed, key)).toEqual(shared);

    const wrapKey = generateKey();
    const meta = sealShareMeta(id, { noteId: 'n', key: 'k', title: 'T' }, wrapKey);
    const plain = decrypt(fromBase64(meta), wrapKey, `sn1:sharemeta:${id}`);
    expect(plain.length).toBeGreaterThanOrEqual(512);
    // Dans la limite de la colonne `meta` (2 000 caractères).
    const longTitle = sealShareMeta(id, { noteId: 'n'.repeat(36), key: 'k'.repeat(43), title: '€'.repeat(80) }, wrapKey);
    expect(longTitle.length).toBeLessThanOrEqual(2000);
  });

  it('refuse un document démesurément imbriqué', () => {
    let deep: SharedNote['doc'] = { type: 'text', text: 'fond' };
    for (let i = 0; i < 100; i += 1) deep = { type: 'blockquote', content: [deep] };
    const doc = { type: 'doc', content: [deep] };
    expect(isReasonableDoc(doc)).toBe(false);
    expect(isReasonableDoc(shared.doc)).toBe(true);

    const key = generateKey();
    expect(() => openShare(id, sealShare(id, { ...shared, doc }, key), key)).toThrow();
  });
});
