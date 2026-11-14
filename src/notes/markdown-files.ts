import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { MAX_ATTACHMENT_BYTES } from '@/notes/blobs';
import { markdownFileName, safeFileName } from '@/notes/markdown';
import { ImportError } from '@/notes/text-import';
import { MAX_ZIP_BYTES } from '@/notes/zip-import';

/** L'import et l'export de fichiers existent sur cette plateforme. */
export const markdownFilesSupported = true;

/** Délai laissé à l'app destinataire pour lire le fichier avant sa suppression. */
const EXPORT_LIFETIME_MS = 2 * 60 * 1000;

/** Dossier temporaire des exports. */
const exportDirectory = () => new Directory(Paths.cache, 'exports');

function clearExports() {
  try {
    const directory = exportDirectory();
    if (directory.exists) directory.delete();
  } catch {
    // Rien à supprimer, ou suppression retentée au prochain export ou lancement.
  }
}

// Un export resté en clair après une fermeture de l'app est supprimé au lancement.
clearExports();

let pendingCleanup: ReturnType<typeof setTimeout> | null = null;

/**
 * Propose un fichier aux autres apps (enregistrer, envoyer, ouvrir…).
 * Le fichier quitte le coffre **en clair**. Sa copie dans le cache de l'app
 * est supprimée deux minutes après le partage (l'app destinataire peut la
 * lire après la fermeture de la feuille de partage), au prochain partage, ou
 * au prochain lancement.
 */
export async function shareFile(
  name: string,
  content: string | Uint8Array,
  mimeType: string,
  UTI?: string,
): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Le partage de fichiers n'est pas disponible sur cet appareil.");
  }
  if (pendingCleanup) clearTimeout(pendingCleanup);
  clearExports();
  exportDirectory().create({ intermediates: true });
  const file = new File(exportDirectory(), safeFileName(name));
  file.create();
  try {
    await file.write(content);
    await Sharing.shareAsync(file.uri, { mimeType, ...(UTI ? { UTI } : {}) });
  } finally {
    pendingCleanup = setTimeout(clearExports, EXPORT_LIFETIME_MS);
  }
}

export function shareMarkdown(title: string, markdown: string): Promise<void> {
  return shareFile(markdownFileName(title), markdown, 'text/markdown', 'net.daringfireball.markdown');
}

/**
 * Fait choisir un fichier à joindre à une note ; `null` si l'utilisateur annule.
 * @throws ImportError si le fichier est trop volumineux.
 */
export async function pickAttachment(): Promise<{
  name: string;
  mime: string;
  bytes: Uint8Array;
} | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const copy = new File(asset.uri);
  try {
    if ((asset.size ?? copy.size) > MAX_ATTACHMENT_BYTES) {
      throw new ImportError('Ce fichier est trop volumineux (20 Mo au maximum).');
    }
    return {
      name: asset.name,
      mime: asset.mimeType ?? 'application/octet-stream',
      bytes: new Uint8Array(await copy.arrayBuffer()),
    };
  } finally {
    // La copie de travail en clair ne reste pas dans le cache.
    if (copy.exists) copy.delete();
  }
}

/**
 * Fait choisir un fichier à importer (texte ou archive zip), quel que soit son
 * type ; `null` si l'utilisateur annule. C'est le contenu qui dit ensuite de
 * quoi il s'agit, et s'il n'est pas trop gros pour son type.
 * @throws ImportError si le fichier dépasse la taille d'une archive zip.
 */
export async function pickTextFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // Selon l'appareil, un même fichier texte est annoncé sous des types très variés.
    type: '*/*',
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const copy = new File(asset.uri);
  try {
    if ((asset.size ?? copy.size) > MAX_ZIP_BYTES) {
      throw new ImportError('Ce fichier est trop volumineux (20 Mo au maximum pour une archive zip).');
    }
    return { name: asset.name, bytes: new Uint8Array(await copy.arrayBuffer()) };
  } finally {
    // La copie de travail en clair ne reste pas dans le cache.
    if (copy.exists) copy.delete();
  }
}
