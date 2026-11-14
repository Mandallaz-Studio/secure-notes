import {
  chunkCountOf,
  joinChunks,
  newFileKey,
  openChunk,
  sealChunk,
  sealedSizeOf,
  unwrapFileKey,
  wrapFileKey,
} from '@/crypto/chunks';
import type { NoteStore } from '@/notes/types';

/**
 * Synchronisation des blobs (images et fichiers joints), après celle des notes.
 *
 *  1. Envoi : les blobs référencés par une note et absents du serveur.
 *  2. Téléchargement : les blobs référencés dont le contenu n'est pas ici.
 *  3. Ménage : un blob qu'aucune note ne référence plus, corbeille comprise,
 *     est supprimé ici et sur le serveur — après un délai, le temps que la
 *     note qui vient de le recevoir soit enregistrée.
 *
 * Un appareil ne supprime du serveur que des blobs qu'il connaît : un blob
 * envoyé par un autre appareil pour une note pas encore reçue n'est pas touché.
 * Si un blob encore référencé ici a disparu du serveur (supprimé par un
 * appareil qui ne voyait plus la note), il est renvoyé.
 */

export type RemoteAttachment = {
  wrappedKey: string;
  chunkCount: number;
  /** Taille totale des blocs chiffrés : c'est elle que le serveur compte dans le quota. */
  sizeBytes: number;
};

export type StorageUsage = { usedBytes: number; quotaBytes: number };

/** Le serveur a refusé un envoi : le quota du compte est atteint. */
export class QuotaExceededError extends Error {}

export interface BlobRemote {
  listAttachmentIds(): Promise<string[]>;
  getAttachment(id: string): Promise<RemoteAttachment | null>;
  /**
   * Déclare un fichier : le serveur réserve sa taille sur le quota.
   * @returns `false` si le fichier existe déjà.
   * @throws QuotaExceededError si le quota du compte ne suffit pas.
   */
  createAttachment(id: string, attachment: RemoteAttachment): Promise<boolean>;
  /**
   * Envoie un bloc chiffré ; sans effet s'il existe déjà.
   * @throws QuotaExceededError si le quota du compte est atteint.
   */
  putChunk(id: string, index: number, data: Uint8Array): Promise<void>;
  getChunk(id: string, index: number): Promise<Uint8Array | null>;
  /** Supprime les blocs du fichier, puis sa déclaration. */
  deleteAttachment(id: string): Promise<void>;
  getUsage(): Promise<StorageUsage | null>;
}

export type BlobSyncResult = {
  uploaded: number;
  downloaded: number;
  removed: number;
  /** Blobs refusés par le serveur faute de place. */
  overQuota: number;
  /** Blobs du serveur illisibles (altérés), ignorés. */
  unreadable: number;
  usage: StorageUsage | null;
};

/** Délai avant de supprimer un blob que plus aucune note ne référence. */
export const ORPHAN_GRACE_MS = 10 * 60 * 1000;

async function upload(
  id: string,
  data: Uint8Array,
  remote: BlobRemote,
  wrapKey: Uint8Array,
): Promise<void> {
  const chunkCount = chunkCountOf(data.length);
  const sizeBytes = sealedSizeOf(data.length);
  let fileKey: Uint8Array | null = null;
  // Reprise d'un envoi interrompu : les blocs déjà là ont été chiffrés avec la clé du serveur.
  const existing = await remote.getAttachment(id);
  if (existing) {
    try {
      if (existing.chunkCount !== chunkCount || existing.sizeBytes !== sizeBytes) {
        throw new Error('taille différente');
      }
      fileKey = unwrapFileKey(id, existing.wrappedKey, wrapKey);
    } catch {
      await remote.deleteAttachment(id);
    }
  }
  if (!fileKey) {
    fileKey = newFileKey();
    await remote.createAttachment(id, {
      wrappedKey: wrapFileKey(id, fileKey, wrapKey),
      chunkCount,
      sizeBytes,
    });
  }
  try {
    for (let index = 0; index < chunkCount; index += 1) {
      await remote.putChunk(id, index, sealChunk(id, data, index, fileKey));
    }
  } finally {
    fileKey.fill(0);
  }
}

/**
 * @returns le contenu ; `null` si le fichier n'est pas (encore entièrement) sur
 *   le serveur ; `'unreadable'` s'il ne se déchiffre pas avec la clé du compte.
 */
async function download(
  id: string,
  remote: BlobRemote,
  wrapKey: Uint8Array,
): Promise<Uint8Array | 'unreadable' | null> {
  const attachment = await remote.getAttachment(id);
  if (!attachment) return null;
  let fileKey: Uint8Array;
  try {
    fileKey = unwrapFileKey(id, attachment.wrappedKey, wrapKey);
  } catch {
    return 'unreadable';
  }
  try {
    const chunks: Uint8Array[] = [];
    for (let index = 0; index < attachment.chunkCount; index += 1) {
      const sealed = await remote.getChunk(id, index);
      if (sealed === null) return null;
      try {
        chunks.push(openChunk(id, sealed, index, attachment.chunkCount, fileKey));
      } catch {
        return 'unreadable';
      }
    }
    return joinChunks(chunks);
  } finally {
    fileKey.fill(0);
  }
}

export async function synchronizeBlobs(
  store: NoteStore,
  remote: BlobRemote,
  wrapKey: Uint8Array,
  now: () => number = Date.now,
): Promise<BlobSyncResult> {
  const result: BlobSyncResult = {
    uploaded: 0,
    downloaded: 0,
    removed: 0,
    overQuota: 0,
    unreadable: 0,
    usage: null,
  };
  const blobs = await store.listBlobs();
  if (blobs.length === 0) {
    result.usage = await remote.getUsage();
    return result;
  }
  const onServer = new Set(await remote.listAttachmentIds());

  // Ménage d'abord : la place libérée peut servir aux envois qui suivent.
  for (const blob of blobs) {
    if (blob.referenced || !blob.hasData || now() - blob.createdAt < ORPHAN_GRACE_MS) continue;
    if (onServer.has(blob.id)) await remote.deleteAttachment(blob.id);
    await store.deleteBlob(blob.id);
    result.removed += 1;
  }

  for (const blob of blobs) {
    if (!blob.referenced) continue;
    if (!blob.hasData) {
      if (!onServer.has(blob.id)) continue;
      const data = await download(blob.id, remote, wrapKey);
      if (data === 'unreadable') {
        result.unreadable += 1;
      } else if (data) {
        await store.storeRemoteBlob(blob.id, data);
        result.downloaded += 1;
      }
      continue;
    }
    if (blob.uploaded && onServer.has(blob.id)) continue;
    const data = await store.getBlob(blob.id);
    if (!data) continue;
    try {
      await upload(blob.id, data, remote, wrapKey);
      await store.setBlobUploaded(blob.id, true);
      result.uploaded += 1;
    } catch (cause) {
      if (!(cause instanceof QuotaExceededError)) throw cause;
      // La déclaration et les blocs déjà envoyés occupent le quota pour rien : on les retire.
      await remote.deleteAttachment(blob.id);
      await store.setBlobUploaded(blob.id, false);
      result.overQuota += 1;
    }
  }

  result.usage = await remote.getUsage();
  return result;
}
