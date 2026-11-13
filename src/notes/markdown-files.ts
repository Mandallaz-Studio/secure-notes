import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { markdownFileName } from '@/notes/markdown';

/** L'import et l'export de fichiers Markdown existent sur cette plateforme. */
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
 * Propose le fichier Markdown aux autres apps (enregistrer, envoyer…).
 * Le fichier quitte le coffre **en clair**. Sa copie dans le cache de l'app
 * est supprimée deux minutes après le partage (l'app destinataire peut la
 * lire après la fermeture de la feuille de partage), au prochain export, ou
 * au prochain lancement.
 */
export async function shareMarkdown(title: string, markdown: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Le partage de fichiers n'est pas disponible sur cet appareil.");
  }
  if (pendingCleanup) clearTimeout(pendingCleanup);
  clearExports();
  exportDirectory().create({ intermediates: true });
  const file = new File(exportDirectory(), markdownFileName(title));
  file.create();
  try {
    await file.write(markdown);
    await Sharing.shareAsync(file.uri, { mimeType: 'text/markdown', UTI: 'net.daringfireball.markdown' });
  } finally {
    pendingCleanup = setTimeout(clearExports, EXPORT_LIFETIME_MS);
  }
}

/** Fait choisir un fichier Markdown ; `null` si l'utilisateur annule. */
export async function pickMarkdown(): Promise<{ name: string; markdown: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // Selon l'appareil, un `.md` est annoncé comme Markdown, texte ou fichier quelconque.
    type: ['text/*', 'application/octet-stream'],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const copy = new File(asset.uri);
  try {
    return { name: asset.name, markdown: await copy.text() };
  } finally {
    // La copie de travail en clair ne reste pas dans le cache.
    if (copy.exists) copy.delete();
  }
}
