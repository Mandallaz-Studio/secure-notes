import { utf8Encode } from '@/crypto/aead';
import { base64ToBytes, bytesToBase64 } from '@/crypto/base64';
import { newId } from '@/notes/model';
import { parseDoc, type RichNode } from '@/notes/rich-text';
import type { Note, NoteStore } from '@/notes/types';

/**
 * Blobs : contenus binaires des notes (images du texte, fichiers joints).
 *
 * Un blob est stocké à part de la note, dans la base chiffrée, et synchronisé
 * à part, chiffré par blocs. La note n'en garde que l'identifiant : dans le
 * document pour une image (`src: "sn-blob:<id>"`), dans `attachments` pour un
 * fichier joint. Un blob ne change jamais.
 */

/** Préfixe de l'adresse d'une image stockée dans un blob. */
export const BLOB_SCHEME = 'sn-blob:';

/** Taille maximale d'un fichier joint. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATA_IMAGE = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]*)$/i;

const blobIdOfSrc = (src: unknown): string | null => {
  if (typeof src !== 'string' || !src.startsWith(BLOB_SCHEME)) return null;
  const id = src.slice(BLOB_SCHEME.length);
  return UUID.test(id) ? id : null;
};

function collectImageIds(node: RichNode, into: Set<string>): void {
  if (node.type === 'image') {
    const id = blobIdOfSrc(node.attrs?.src);
    if (id) into.add(id);
  }
  node.content?.forEach((child) => collectImageIds(child, into));
}

/** Identifiants des blobs dont la note a besoin : images du texte et fichiers joints. */
export function blobIdsOf(note: Pick<Note, 'body' | 'bodyFormat' | 'attachments'>): string[] {
  const ids = new Set<string>();
  if (note.bodyFormat === 'tiptap' && note.body.includes(BLOB_SCHEME)) {
    const doc = parseDoc(note.body);
    if (doc) collectImageIds(doc, ids);
  }
  for (const attachment of note.attachments) ids.add(attachment.id);
  return [...ids];
}

/** Type d'une image d'après ses premiers octets. */
export function imageMimeOf(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return 'image/webp';
  if (bytes[0] === 0x3c) return 'image/svg+xml';
  return 'image/jpeg';
}

/** Image affichée à la place d'un blob qui n'est pas encore sur cet appareil. */
function placeholderFor(id: string): string {
  // L'identifiant rend l'adresse unique : elle peut ainsi être reconvertie en référence.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><!-- ${id} -->` +
    '<rect width="320" height="120" rx="8" fill="#8884"/>' +
    '<text x="160" y="66" font-family="sans-serif" font-size="14" fill="#888" ' +
    'text-anchor="middle">Image en cours de téléchargement…</text></svg>';
  return `data:image/svg+xml;base64,${bytesToBase64(utf8Encode(svg))}`;
}

/**
 * Correspondance, le temps d'une session d'édition, entre les blobs et les
 * adresses `data:` sous lesquelles l'éditeur les affiche.
 */
export type ImageCache = {
  uriById: Map<string, string>;
  idByUri: Map<string, string>;
  /** Blobs affichés par une image d'attente : leur contenu n'est pas ici. */
  placeholders: Set<string>;
};

export function newImageCache(): ImageCache {
  return { uriById: new Map(), idByUri: new Map(), placeholders: new Set() };
}

async function mapImages(
  node: RichNode,
  convert: (src: unknown) => Promise<string | null>,
): Promise<RichNode | null> {
  if (node.type === 'image') {
    const src = await convert(node.attrs?.src);
    return src === null ? null : { ...node, attrs: { ...node.attrs, src } };
  }
  if (!node.content) return node;
  const content: RichNode[] = [];
  for (const child of node.content) {
    const mapped = await mapImages(child, convert);
    if (mapped) content.push(mapped);
  }
  return { ...node, content };
}

const orEmpty = (doc: RichNode | null): RichNode =>
  doc && (doc.content?.length ?? 0) > 0 ? doc : { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * Forme affichée : chaque référence à un blob devient une adresse `data:`.
 * Une image sans contenu local prend une image d'attente. Une image qui
 * pointerait hors de l'app (adresse distante) est retirée : l'afficher ferait
 * sortir une requête.
 */
export async function toEditorImages(
  doc: RichNode,
  store: Pick<NoteStore, 'getBlob'>,
  cache: ImageCache,
): Promise<RichNode> {
  return orEmpty(
    await mapImages(doc, async (src) => {
      if (typeof src === 'string' && DATA_IMAGE.test(src)) return src;
      const id = blobIdOfSrc(src);
      if (!id) return null;
      const known = cache.uriById.get(id);
      if (known) return known;
      const bytes = await store.getBlob(id);
      const uri = bytes
        ? `data:${imageMimeOf(bytes)};base64,${bytesToBase64(bytes)}`
        : placeholderFor(id);
      if (!bytes) cache.placeholders.add(id);
      cache.uriById.set(id, uri);
      cache.idByUri.set(uri, id);
      return uri;
    }),
  );
}

/**
 * Forme stockée : chaque image `data:` devient une référence à un blob, créé
 * au besoin (image tout juste insérée, collée, ou importée).
 */
export async function toStoredImages(
  doc: RichNode,
  store: Pick<NoteStore, 'putBlob' | 'missingBlobs'>,
  cache: ImageCache,
): Promise<RichNode> {
  const used = new Set<string>();
  const stored = orEmpty(
    await mapImages(doc, async (src) => {
      if (blobIdOfSrc(src)) return src as string;
      const match = typeof src === 'string' ? DATA_IMAGE.exec(src) : null;
      if (!match) return null;
      const uri = src as string;
      let id = cache.idByUri.get(uri);
      if (!id) {
        id = newId();
        await store.putBlob(id, base64ToBytes(match[2]));
        cache.uriById.set(id, uri);
        cache.idByUri.set(uri, id);
      }
      used.add(id);
      return `${BLOB_SCHEME}${id}`;
    }),
  );
  // Une image retirée puis rétablie (annulation) a pu perdre son blob entre-temps.
  const real = [...used].filter((id) => !cache.placeholders.has(id));
  for (const id of real.length > 0 ? await store.missingBlobs(real) : []) {
    const match = DATA_IMAGE.exec(cache.uriById.get(id) ?? '');
    if (match) await store.putBlob(id, base64ToBytes(match[2]));
  }
  return stored;
}

/** Taille lisible : « 340 Ko », « 2,4 Mo ». */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}
