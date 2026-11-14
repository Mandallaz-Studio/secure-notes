import {
  decrypt,
  encrypt,
  fromBase64,
  generateKey,
  toBase64,
  utf8Decode,
  utf8Encode,
} from '@/crypto/aead';
import type {
  Attachment,
  BodyFormat,
  Category,
  Note,
  RemoteChange,
  SyncItem,
} from '@/notes/types';

/**
 * Forme chiffrée d'un élément envoyé au serveur.
 *
 * Chaque envoi tire une clé aléatoire, chiffrée par la clé d'enveloppe du
 * compte. Le serveur ne peut distinguer ni une note d'une catégorie, ni une
 * modification d'une suppression définitive, ni lire titre, contenu, catégorie
 * ou état : tout est dans le blob.
 *
 * Une suppression est donc elle aussi un message chiffré : sans la clé du
 * compte, personne — pas même le serveur — ne peut faire supprimer un élément
 * sur les appareils.
 *
 * L'identifiant de l'élément est authentifié avec le blob : le serveur ne peut
 * pas présenter le contenu d'un élément sous l'identifiant d'un autre.
 *
 * Ces formats et contextes font partie des données stockées : ne pas les changer.
 */
export type SealedItem = { ciphertext: string; wrappedKey: string };

const VERSION = 1;
const keyContext = (id: string) => `sn1:key:${id}`;
const itemContext = (id: string) => `sn1:item:${id}`;

type Payload =
  | {
      v: number;
      t: 'note';
      title: string;
      body: string;
      bodyFormat: BodyFormat;
      plainText: string;
      categoryId: string | null;
      archived: boolean;
      /** Absent des notes écrites avant la mise en avant. */
      pinned?: boolean;
      /** Absent des notes écrites avant le dossier privé. */
      hidden?: boolean;
      createdAt: number;
      updatedAt: number;
      deletedAt: number | null;
      /** Absent des notes écrites avant les fichiers joints. */
      attachments?: Attachment[];
    }
  | { v: number; t: 'category'; name: string; createdAt: number; updatedAt: number }
  | { v: number; t: 'deleted' };

export function idOf(item: SyncItem): string {
  return item.kind === 'note' ? item.note.id : item.category.id;
}

function payloadOf(item: SyncItem): Payload {
  if (item.kind === 'category') {
    const { name, createdAt, updatedAt } = item.category;
    return { v: VERSION, t: 'category', name, createdAt, updatedAt };
  }
  const { id: _id, ...fields } = item.note;
  return { v: VERSION, t: 'note', ...fields };
}

function seal(id: string, payload: Payload, wrapKey: Uint8Array): SealedItem {
  const itemKey = generateKey();
  try {
    return {
      wrappedKey: toBase64(encrypt(itemKey, wrapKey, keyContext(id))),
      ciphertext: toBase64(encrypt(utf8Encode(JSON.stringify(payload)), itemKey, itemContext(id))),
    };
  } finally {
    itemKey.fill(0);
  }
}

export function sealItem(item: SyncItem, wrapKey: Uint8Array): SealedItem {
  return seal(idOf(item), payloadOf(item), wrapKey);
}

/** Suppression définitive de l'élément `id`. */
export function sealDeletion(id: string, wrapKey: Uint8Array): SealedItem {
  return seal(id, { v: VERSION, t: 'deleted' }, wrapKey);
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isAttachment = (value: unknown): value is Attachment => {
  const item = value as Attachment | null;
  return (
    typeof item === 'object' &&
    item !== null &&
    isText(item.id) &&
    isText(item.name) &&
    isText(item.mime) &&
    isTime(item.size)
  );
};

/**
 * @throws si le blob a été altéré, n'appartient pas à cet identifiant ou à ce
 *   compte, ou vient d'une version plus récente de l'app.
 */
export function openItem(id: string, sealed: SealedItem, wrapKey: Uint8Array): RemoteChange {
  const itemKey = decrypt(fromBase64(sealed.wrappedKey), wrapKey, keyContext(id));
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(
      utf8Decode(decrypt(fromBase64(sealed.ciphertext), itemKey, itemContext(id))),
    );
  } finally {
    itemKey.fill(0);
  }
  if (payload.v !== VERSION) {
    throw new Error(`Format d'élément inconnu (version ${String(payload.v)})`);
  }
  if (payload.t === 'deleted') {
    return { kind: 'deleted', id };
  }
  const { createdAt, updatedAt } = payload;
  if (!isTime(createdAt) || !isTime(updatedAt)) {
    throw new Error('Élément invalide');
  }
  if (payload.t === 'category' && isText(payload.name)) {
    const category: Category = { id, name: payload.name, createdAt, updatedAt };
    return { kind: 'category', category };
  }
  const { title, body, bodyFormat, plainText, categoryId, archived, deletedAt } = payload;
  const pinned = payload.pinned ?? false;
  const hidden = payload.hidden ?? false;
  const attachments = payload.attachments ?? [];
  if (
    payload.t === 'note' &&
    isText(title) &&
    isText(body) &&
    (bodyFormat === 'text' || bodyFormat === 'tiptap') &&
    isText(plainText) &&
    (categoryId === null || isText(categoryId)) &&
    typeof archived === 'boolean' &&
    typeof pinned === 'boolean' &&
    typeof hidden === 'boolean' &&
    (deletedAt === null || isTime(deletedAt)) &&
    Array.isArray(attachments) &&
    attachments.every(isAttachment)
  ) {
    const note: Note = {
      id,
      title,
      body,
      bodyFormat,
      plainText,
      categoryId,
      archived,
      pinned,
      hidden,
      createdAt,
      updatedAt,
      deletedAt,
      attachments: attachments.map(({ id: blobId, name, mime, size }) => ({
        id: blobId,
        name,
        mime,
        size,
      })),
    };
    return { kind: 'note', note };
  }
  throw new Error('Élément invalide');
}
