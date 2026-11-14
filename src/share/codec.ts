import {
  decrypt,
  encrypt,
  fromBase64,
  KEY_BYTES,
  toBase64,
  utf8Decode,
  utf8Encode,
} from '@/crypto/aead';
import { newImageCache, toEditorImages } from '@/notes/blobs';
import { docOfContent, type RichNode } from '@/notes/rich-text';
import type { Note, NoteStore } from '@/notes/types';

/**
 * Partage d'une note par lien.
 *
 * La note est copiée, images comprises, et chiffrée avec une clé tirée au
 * hasard pour ce partage. Le lien a la forme `<site>/s/<id>#<clé>` : le
 * fragment (après « # ») n'est jamais envoyé au serveur, qui ne voit donc que
 * la copie chiffrée. Si le compte utilise une autre instance que celle prévue
 * à la compilation, son adresse et sa clé publique suivent la clé dans le
 * fragment : `#<clé>.<instance>`.
 *
 * Ces formats et contextes font partie des liens déjà émis : ne pas les changer.
 */

/** Copie partagée d'une note : ce que le destinataire du lien peut lire. */
export type SharedNote = {
  v: 1;
  title: string;
  /** Document, couleurs en jetons de palette, images en adresses `data:`. */
  doc: RichNode;
  sharedAt: number;
};

/** Ce que le propriétaire garde, chiffré, à côté de la copie. */
export type ShareMeta = {
  noteId: string;
  /** Clé du lien, en base64 : permet de recopier le lien depuis un autre appareil. */
  key: string;
  title: string;
};

export type ShareInstance = { url: string; anonKey: string };

/** Erreur de partage dont le message peut être montré tel quel. */
export class ShareError extends Error {}

/** Taille maximale de la copie partagée, avant chiffrement. */
export const MAX_SHARE_BYTES = 4 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isShareId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

const noteContext = (id: string) => `sn1:share:${id}`;
const metaContext = (id: string) => `sn1:sharemeta:${id}`;

/**
 * Copie de la note telle qu'elle sera partagée. Les fichiers joints n'en font
 * pas partie.
 * @throws ShareError si une image n'est pas sur l'appareil, ou si la note est trop lourde.
 */
export async function buildSharedNote(
  note: Note,
  store: Pick<NoteStore, 'getBlob'>,
  now: number,
): Promise<SharedNote> {
  const cache = newImageCache();
  const doc = await toEditorImages(docOfContent(note), store, cache);
  if (cache.placeholders.size > 0) {
    throw new ShareError(
      "Une image de cette note n'est pas encore sur cet appareil : réessayez après la prochaine synchronisation.",
    );
  }
  return { v: 1, title: note.title, doc, sharedAt: now };
}

/** @returns la copie chiffrée, en base64. */
export function sealShare(id: string, note: SharedNote, shareKey: Uint8Array): string {
  const plain = utf8Encode(JSON.stringify(note));
  if (plain.length > MAX_SHARE_BYTES) {
    throw new ShareError(
      'Cette note est trop volumineuse pour être partagée par lien (4 Mo au plus, images comprises).',
    );
  }
  return toBase64(encrypt(plain, shareKey, noteContext(id)));
}

/** @throws si la clé n'est pas celle du lien, ou si la copie a été altérée. */
export function openShare(id: string, ciphertext: string, shareKey: Uint8Array): SharedNote {
  const parsed: unknown = JSON.parse(
    utf8Decode(decrypt(fromBase64(ciphertext), shareKey, noteContext(id))),
  );
  const note = parsed as Partial<SharedNote> | null;
  if (
    typeof note !== 'object' ||
    note === null ||
    note.v !== 1 ||
    typeof note.title !== 'string' ||
    typeof note.sharedAt !== 'number' ||
    typeof note.doc !== 'object' ||
    note.doc === null ||
    note.doc.type !== 'doc'
  ) {
    throw new Error('Copie partagée de forme inattendue');
  }
  return { v: 1, title: note.title, doc: note.doc, sharedAt: note.sharedAt };
}

export function sealShareMeta(id: string, meta: ShareMeta, wrapKey: Uint8Array): string {
  return toBase64(encrypt(utf8Encode(JSON.stringify(meta)), wrapKey, metaContext(id)));
}

/** @returns `null` si la ligne n'a pas été écrite par ce compte, ou a été altérée. */
export function openShareMeta(id: string, sealed: string, wrapKey: Uint8Array): ShareMeta | null {
  try {
    const meta = JSON.parse(
      utf8Decode(decrypt(fromBase64(sealed), wrapKey, metaContext(id))),
    ) as Partial<ShareMeta> | null;
    if (
      typeof meta?.noteId !== 'string' ||
      typeof meta.key !== 'string' ||
      typeof meta.title !== 'string'
    ) {
      return null;
    }
    return { noteId: meta.noteId, key: meta.key, title: meta.title };
  } catch {
    return null;
  }
}

/**
 * @param base Adresse du site de lecture (`https://notes.exemple.fr`) ou
 *   schéma de l'app (`securenotes://`).
 * @param instance À préciser si le destinataire ne peut pas la deviner :
 *   instance autre que celle prévue à la compilation.
 */
export function buildShareLink(
  base: string,
  id: string,
  shareKey: Uint8Array,
  instance: ShareInstance | null,
): string {
  const root = base.endsWith('://') ? base : `${base.replace(/\/+$/, '')}/`;
  const where = instance
    ? `.${toBase64(utf8Encode(JSON.stringify([instance.url, instance.anonKey])))}`
    : '';
  return `${root}s/${id}#${toBase64(shareKey)}${where}`;
}

/** Lit le fragment d'un lien ; `null` s'il est incomplet ou malformé. */
export function parseShareFragment(
  fragment: string,
): { key: Uint8Array; instance: ShareInstance | null } | null {
  try {
    const [keyPart, instancePart, ...rest] = fragment.replace(/^#/, '').split('.');
    if (rest.length > 0) return null;
    const key = fromBase64(keyPart);
    if (key.length !== KEY_BYTES) return null;
    if (instancePart === undefined) return { key, instance: null };
    const pair: unknown = JSON.parse(utf8Decode(fromBase64(instancePart)));
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== 'string' ||
      typeof pair[1] !== 'string' ||
      // La page de lecture ne parle qu'en HTTPS.
      !/^https:\/\/[^/?#\s]+[^?#\s]*$/i.test(pair[0])
    ) {
      return null;
    }
    return { key, instance: { url: pair[0], anonKey: pair[1] } };
  } catch {
    return null;
  }
}
