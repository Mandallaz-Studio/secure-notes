import { strToU8, zipSync, type Zippable } from 'fflate';

import { BLOB_SCHEME, imageMimeOf } from '@/notes/blobs';
import { markdownFileName, noteToMarkdown, safeFileName } from '@/notes/markdown';
import { docOfContent, type RichNode } from '@/notes/rich-text';
import type { Category, Note, NoteStore, NoteView } from '@/notes/types';

/**
 * Export complet du coffre, en clair, dans une archive zip :
 *
 *   LISEZMOI.txt
 *   secure-notes.json                 tout, sans perte (document de l'éditeur compris)
 *   notes/<catégorie>/<titre>.md      notes actives
 *   archives/<catégorie>/<titre>.md   notes archivées
 *   corbeille/<catégorie>/<titre>.md  notes de la corbeille
 *   fichiers/<id>.<ext>               images du texte
 *   fichiers/<id>/<nom>               fichiers joints
 *
 * Les fichiers Markdown sont lisibles partout ; `secure-notes.json` garde ce
 * que Markdown perd (couleurs, dates, identifiants) pour un import futur.
 */

export const EXPORT_FORMAT = 'secure-notes-export';
export const EXPORT_VERSION = 1;

type ExportStore = Pick<NoteStore, 'listNotes' | 'getNote' | 'listCategories' | 'getBlob'>;

export type FullExport = {
  /** Contenu de l'archive zip. */
  zip: Uint8Array;
  notes: number;
  files: number;
  /** Images et fichiers joints absents de cet appareil (pas encore téléchargés). */
  missing: number;
};

const FOLDERS: Record<NoteView, string> = {
  active: 'notes',
  archived: 'archives',
  trash: 'corbeille',
};

const NO_CATEGORY = 'Sans catégorie';

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/jpeg': 'jpg',
};

const README = `Export Secure Notes
===================

Ce dossier contient vos notes EN CLAIR : quiconque y accède peut les lire.
Gardez-le en lieu sûr, et supprimez-le quand vous n'en avez plus besoin.

- notes/, archives/, corbeille/ : une note par fichier Markdown, rangée par
  catégorie. Les couleurs du texte et du surlignage n'existent pas en Markdown.
- fichiers/ : images des notes et fichiers joints.
- secure-notes.json : toutes les données, sans perte (mise en forme complète,
  dates, catégories), lisibles par un programme.
`;

/** Chemin libre, numéroté au besoin : « titre.md », « titre (2).md »… */
function uniquePath(taken: Set<string>, folder: string, name: string): string {
  const dot = name.lastIndexOf('.');
  const [base, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let index = 1; ; index += 1) {
    const candidate = `${folder}/${index === 1 ? base : `${base} (${index})`}${extension}`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

/** Remplace chaque image stockée par un lien relatif vers son fichier. */
function linkImages(node: RichNode, pathOf: (id: string) => string | null): RichNode {
  if (node.type === 'image') {
    const src = node.attrs?.src;
    if (typeof src === 'string' && src.startsWith(BLOB_SCHEME)) {
      const path = pathOf(src.slice(BLOB_SCHEME.length));
      return { ...node, attrs: { ...node.attrs, src: path ?? '' } };
    }
    return node;
  }
  return node.content
    ? { ...node, content: node.content.map((child) => linkImages(child, pathOf)) }
    : node;
}

function collectImageIds(node: RichNode, into: Set<string>): void {
  const src = node.type === 'image' ? node.attrs?.src : null;
  if (typeof src === 'string' && src.startsWith(BLOB_SCHEME)) {
    into.add(src.slice(BLOB_SCHEME.length));
  }
  node.content?.forEach((child) => collectImageIds(child, into));
}

/** Les notes Markdown sont à deux niveaux de la racine : `notes/<catégorie>/`. */
const FROM_NOTE = '../../';

export async function buildFullExport(store: ExportStore, now: number): Promise<FullExport> {
  const categories = await store.listCategories();
  const categoryName = new Map<string, string>(
    categories.map((category: Category) => [category.id, category.name]),
  );

  const entries: Zippable = {};
  const taken = new Set<string>();
  const put = (path: string, data: Uint8Array) => {
    // Pas de compression pour les images, déjà compressées.
    entries[path] = /\.(png|jpe?g|gif|webp)$/i.test(path) ? [data, { level: 0 }] : data;
  };

  /** Fichiers déjà écrits : identifiant du blob → chemin dans l'archive. */
  const written = new Map<string, string>();
  let missing = 0;
  let files = 0;

  const writeImage = async (id: string): Promise<string | null> => {
    if (written.has(id)) return written.get(id) || null;
    const bytes = await store.getBlob(id);
    if (!bytes) {
      missing += 1;
      written.set(id, '');
      return null;
    }
    const path = `fichiers/${safeFileName(id)}.${EXTENSIONS[imageMimeOf(bytes)] ?? 'bin'}`;
    put(path, bytes);
    files += 1;
    written.set(id, path);
    return path;
  };

  const writeAttachment = async (id: string, name: string): Promise<string | null> => {
    if (written.has(id)) return written.get(id) || null;
    const bytes = await store.getBlob(id);
    if (!bytes) {
      missing += 1;
      written.set(id, '');
      return null;
    }
    const path = uniquePath(taken, `fichiers/${safeFileName(id)}`, safeFileName(name));
    put(path, bytes);
    files += 1;
    written.set(id, path);
    return path;
  };

  const notes: (Note & { file: string; files: Record<string, string | null> })[] = [];

  for (const view of ['active', 'archived', 'trash'] as NoteView[]) {
    for (const summary of await store.listNotes({ view })) {
      const note = await store.getNote(summary.id);
      if (!note) continue;

      const doc = docOfContent(note);
      const imageIds = new Set<string>();
      collectImageIds(doc, imageIds);
      const paths: Record<string, string | null> = {};
      for (const id of imageIds) paths[id] = await writeImage(id);
      for (const attachment of note.attachments) {
        paths[attachment.id] = await writeAttachment(attachment.id, attachment.name);
      }

      let markdown = noteToMarkdown(
        note.title,
        linkImages(doc, (id) => (paths[id] ? `${FROM_NOTE}${paths[id]}` : null)),
      );
      if (note.attachments.length > 0) {
        const lines = note.attachments.map((attachment) => {
          const path = paths[attachment.id];
          return path
            ? `- [${attachment.name}](${encodeURI(`${FROM_NOTE}${path}`)})`
            : `- ${attachment.name} (absent de cet appareil)`;
        });
        markdown = `${markdown}\n## Fichiers joints\n\n${lines.join('\n')}\n`;
      }

      const category = note.categoryId ? categoryName.get(note.categoryId) : undefined;
      const folder = `${FOLDERS[view]}/${safeFileName(category ?? NO_CATEGORY)}`;
      const file = uniquePath(taken, folder, markdownFileName(note.title));
      put(file, strToU8(markdown));
      notes.push({ ...note, file, files: paths });
    }
  }

  const manifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    categories,
    notes: notes.map(({ plainText: _plainText, ...note }) => note),
  };
  put('secure-notes.json', strToU8(JSON.stringify(manifest, null, 2)));
  put('LISEZMOI.txt', strToU8(README));

  return { zip: zipSync(entries, { level: 6, mtime: new Date(now) }), notes: notes.length, files, missing };
}

/** Nom de l'archive : `secure-notes-AAAA-MM-JJ.zip`. */
export function fullExportFileName(now: number): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `secure-notes-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`;
}
