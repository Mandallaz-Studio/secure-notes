import { strToU8, zipSync } from 'fflate';

import { EXPORT_FORMAT } from '@/notes/full-export';
import { plainTextOf } from '@/notes/rich-text';
import { ImportError, MAX_IMPORT_BYTES } from '@/notes/text-import';
import { isZip, zipToNotes } from '@/notes/zip-import';

describe('import d’une archive zip', () => {
  it('crée une note par fichier texte, dans l’ordre des chemins, et ignore le reste', () => {
    const zip = zipSync({
      'b/Deuxième.md': strToU8('# Titre Markdown\n\nCorps **gras**'),
      'a/Note 10.txt': strToU8('dix'),
      'a/Note 2.txt': strToU8('deux'),
      'image.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]),
      'lettre.rtf': strToU8('{\\rtf1\\ansi Bonjour\\par}'),
      '__MACOSX/a/._Note 2.txt': strToU8('junk'),
      '.DS_Store': strToU8('junk'),
      'vide/': new Uint8Array(),
    });
    expect(isZip(zip)).toBe(true);

    const result = zipToNotes(zip);

    expect(result.notes.map((note) => note.title)).toEqual([
      'Note 2',
      'Note 10',
      'Titre Markdown',
      'lettre',
    ]);
    expect(plainTextOf(result.notes[2].doc)).toContain('Corps gras');
    expect(plainTextOf(result.notes[3].doc)).toBe('Bonjour');
    expect(result.skipped).toEqual([{ path: 'image.png', reason: 'pas un fichier texte' }]);
  });

  it('ignore les fichiers trop gros et les fichiers propres à un export Secure Notes', () => {
    const zip = zipSync({
      'secure-notes.json': strToU8(JSON.stringify({ format: EXPORT_FORMAT, version: 1 })),
      'LISEZMOI.txt': strToU8('mode d’emploi'),
      'notes/Sans catégorie/Courses.md': strToU8('lait'),
      'gros.txt': strToU8('x'.repeat(MAX_IMPORT_BYTES + 1)),
    });

    const result = zipToNotes(zip);

    expect(result.notes.map((note) => note.title)).toEqual(['Courses']);
    expect(result.skipped).toEqual([{ path: 'gros.txt', reason: 'trop volumineux' }]);
  });

  it('refuse une archive illisible ou sans fichier texte', () => {
    expect(() => zipToNotes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toThrow(ImportError);
    expect(() => zipToNotes(zipSync({ 'photo.png': new Uint8Array([0, 1, 2]) }))).toThrow(
      'aucun fichier texte',
    );
  });

  it('ne prend pas un fichier texte pour une archive', () => {
    expect(isZip(strToU8('PK, mais pas une archive'))).toBe(false);
  });
});
