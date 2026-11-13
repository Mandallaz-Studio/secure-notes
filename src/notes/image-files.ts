import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** L'ajout d'images existe sur cette plateforme. */
export const imagesSupported = true;

/** Plus grand côté d'une image dans une note, en pixels. */
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.8;

function remove(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
  }
}

/**
 * Fait choisir une image et la prépare pour une note : réduite à 1600 pixels
 * de côté au plus, recompressée en JPEG (ce qui retire aussi ses métadonnées :
 * lieu, appareil, date) et renvoyée sous forme d'adresse `data:`. L'éditeur
 * l'affiche ainsi ; à l'enregistrement elle devient un blob chiffré, stocké et
 * synchronisé à part (voir `blobs.ts`). `null` si l'utilisateur annule.
 */
export async function pickImage(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'image/*',
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const source = result.assets[0].uri;
  let saved: string | null = null;
  try {
    const context = ImageManipulator.manipulate(source);
    const original = await context.renderAsync();
    let image = original;
    if (Math.max(original.width, original.height) > MAX_SIDE) {
      context.resize(
        original.width >= original.height ? { width: MAX_SIDE } : { height: MAX_SIDE },
      );
      image = await context.renderAsync();
    }
    const output = await image.saveAsync({
      base64: true,
      compress: JPEG_QUALITY,
      format: SaveFormat.JPEG,
    });
    saved = output.uri;
    if (!output.base64) throw new Error('image illisible');
    return `data:image/jpeg;base64,${output.base64}`;
  } finally {
    // Les copies de travail en clair ne restent pas dans le cache.
    remove(source);
    if (saved) remove(saved);
  }
}
