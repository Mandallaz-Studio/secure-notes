import { strFromU8, unzipSync } from 'fflate';

import { EXPORT_FORMAT } from '@/notes/full-export';
import type { RichNode } from '@/notes/rich-text';
import { fileToNote, ImportError, MAX_IMPORT_BYTES } from '@/notes/text-import';

/**
 * Import d'une archive zip : chaque fichier texte qu'elle contient devient une
 * note, selon les mêmes règles qu'un fichier importé seul (voir `text-import`).
 * Les autres fichiers (images, PDF, archives imbriquées…) sont ignorés.
 */

/** Taille maximale de l'archive elle-même. */
export const MAX_ZIP_BYTES = 20 * 1024 * 1024;
/** Au-delà, l'archive est refusée : l'import resterait bloqué trop longtemps. */
export const MAX_ZIP_FILES = 1000;
/** Taille totale décompressée lue au plus (protège des « bombes » zip). */
const MAX_ZIP_CONTENT_BYTES = 100 * 1024 * 1024;

/** Fichiers propres au système qui a créé l'archive, jamais des notes. */
const isSystemFile = (path: string) =>
  path.startsWith('__MACOSX/') ||
  path.split('/').some((part) => part.startsWith('.')) ||
  /(^|\/)(Thumbs\.db|desktop\.ini)$/i.test(path);

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Le fichier commence par la signature d'une archive zip (vide ou non). */
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))
  );
}

export type ZipImport = {
  /** Notes tirées de l'archive, par ordre des chemins. */
  notes: { path: string; title: string; doc: RichNode }[];
  /** Fichiers ignorés (pas du texte, trop volumineux…), avec la raison. */
  skipped: { path: string; reason: string }[];
};

/**
 * Notes tirées des fichiers texte d'une archive zip.
 * @throws ImportError si l'archive est illisible, trop grosse, ou ne contient aucun fichier texte.
 */
export function zipToNotes(bytes: Uint8Array): ZipImport {
  if (bytes.length > MAX_ZIP_BYTES) {
    throw new ImportError('Cette archive est trop volumineuse (20 Mo au maximum).');
  }
  const skipped: ZipImport['skipped'] = [];
  let files = 0;
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith('/') || isSystemFile(file.name)) return false;
        files += 1;
        if (file.originalSize > MAX_IMPORT_BYTES) {
          skipped.push({ path: file.name, reason: 'trop volumineux' });
          return false;
        }
        total += file.originalSize;
        return files <= MAX_ZIP_FILES && total <= MAX_ZIP_CONTENT_BYTES;
      },
    });
  } catch {
    throw new ImportError("Cette archive zip est illisible ou d'un type non pris en charge.");
  }
  if (files > MAX_ZIP_FILES) {
    throw new ImportError(`Cette archive contient trop de fichiers (${MAX_ZIP_FILES} au maximum).`);
  }
  if (total > MAX_ZIP_CONTENT_BYTES) {
    throw new ImportError('Le contenu de cette archive est trop volumineux.');
  }

  // Archive produite par « Exporter toutes les notes » : son manifeste et son
  // mode d'emploi ne sont pas des notes.
  if (isOwnExport(entries['secure-notes.json'])) {
    delete entries['secure-notes.json'];
    delete entries['LISEZMOI.txt'];
  }

  const notes: ZipImport['notes'] = [];
  const paths = Object.keys(entries).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
  for (const path of paths) {
    try {
      notes.push({ path, ...fileToNote(baseName(path), entries[path]) });
    } catch (cause) {
      if (!(cause instanceof ImportError)) throw cause;
      skipped.push({ path, reason: 'pas un fichier texte' });
    }
  }
  if (notes.length === 0) {
    throw new ImportError('Cette archive ne contient aucun fichier texte à importer.');
  }
  return { notes, skipped };
}

function isOwnExport(manifest: Uint8Array | undefined): boolean {
  if (!manifest) return false;
  try {
    return (JSON.parse(strFromU8(manifest)) as { format?: unknown }).format === EXPORT_FORMAT;
  } catch {
    return false;
  }
}
