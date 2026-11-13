import { markdownToNote } from '@/notes/markdown';
import { docFromPlainText, type RichNode } from '@/notes/rich-text';

/**
 * Import d'un fichier texte quelconque.
 *
 * Markdown (`.md`, `.markdown`) et RTF (`.rtf`) sont convertis ; tout autre
 * fichier texte (`.txt`, `.csv`, `.json`, `.log`, code source…) devient une
 * note en texte brut, une ligne par paragraphe. Un fichier binaire (image,
 * PDF, archive…) est refusé.
 */

/** Au-delà, l'éditeur devient trop lent. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** Erreur d'import dont le message peut être montré tel quel. */
export class ImportError extends Error {}

/** Caractères des octets 0x80 à 0x9F en Windows-1252 (ailleurs : identique à Latin-1). */
const CP1252_HIGH =
  '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

function cp1252Char(byte: number): string {
  return byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : String.fromCharCode(byte);
}

/** Décode de l'UTF-8 strict ; `null` si les octets n'en sont pas. */
function decodeUtf8(bytes: Uint8Array): string | null {
  const parts: string[] = [];
  let chunk: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const first = bytes[i];
    let length: number;
    let code: number;
    if (first < 0x80) {
      length = 1;
      code = first;
    } else if (first >= 0xc2 && first <= 0xdf) {
      length = 2;
      code = first & 0x1f;
    } else if (first >= 0xe0 && first <= 0xef) {
      length = 3;
      code = first & 0x0f;
    } else if (first >= 0xf0 && first <= 0xf4) {
      length = 4;
      code = first & 0x07;
    } else {
      return null;
    }
    if (i + length > bytes.length) return null;
    for (let k = 1; k < length; k++) {
      const next = bytes[i + k];
      if ((next & 0xc0) !== 0x80) return null;
      code = (code << 6) | (next & 0x3f);
    }
    const tooShort =
      (length === 3 && code < 0x800) || (length === 4 && (code < 0x10000 || code > 0x10ffff));
    if (tooShort || (code >= 0xd800 && code <= 0xdfff)) return null;
    if (code > 0xffff) {
      const offset = code - 0x10000;
      chunk.push(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
    } else {
      chunk.push(code);
    }
    if (chunk.length >= 8192) {
      parts.push(String.fromCharCode(...chunk));
      chunk = [];
    }
    i += length;
  }
  parts.push(String.fromCharCode(...chunk));
  return parts.join('');
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const parts: string[] = [];
  let chunk: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    chunk.push(littleEndian ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
    if (chunk.length >= 8192) {
      parts.push(String.fromCharCode(...chunk));
      chunk = [];
    }
  }
  parts.push(String.fromCharCode(...chunk));
  return parts.join('');
}

/**
 * Texte d'un fichier : UTF-8 (avec ou sans marque d'ordre), UTF-16 avec marque
 * d'ordre, sinon Windows-1252 (anciens fichiers Windows).
 * @throws ImportError si le fichier n'est pas du texte.
 */
export function decodeText(bytes: Uint8Array): string {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = decodeUtf16(bytes.subarray(2), true);
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = decodeUtf16(bytes.subarray(2), false);
  } else {
    const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const body = hasBom ? bytes.subarray(3) : bytes;
    text = decodeUtf8(body) ?? Array.from(body, cp1252Char).join('');
  }
  // Un fichier texte ne contient pas de caractères de contrôle (hors tabulation,
  // sauts de ligne et saut de page).
  if (/[\u0000-\u0008\u000e-\u001a\u001c-\u001f]/.test(text)) {
    throw new ImportError("Ce fichier n'est pas un fichier texte.");
  }
  return text.replace(/\r\n?/g, '\n').replace(/\f/g, '\n');
}

/** Groupes RTF qui ne portent pas de texte du document. */
const RTF_SKIPPED = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'header',
  'footer',
  'footnote',
  'generator',
  'listtable',
  'listoverridetable',
  'themedata',
  'colorschememapping',
  'datastore',
  'latentstyles',
  'rsidtbl',
  'xmlnstbl',
  'filetbl',
  'revtbl',
]);

const RTF_SYMBOLS: Record<string, string> = {
  par: '\n',
  line: '\n',
  sect: '\n',
  page: '\n',
  row: '\n',
  tab: '\t',
  cell: '\t',
  emdash: '—',
  endash: '–',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  emspace: ' ',
  enspace: ' ',
};

/** Texte d'un document RTF, sans sa mise en forme. */
export function rtfToText(rtf: string): string {
  let out = '';
  /** Par groupe ouvert : le groupe est ignoré ; nombre de caractères de repli après `\u`. */
  const stack: { skip: boolean; fallback: number }[] = [];
  let skip = false;
  let fallback = 1;
  /** Caractères de repli restant à ignorer après un `\uN`. */
  let pendingFallback = 0;
  let i = 0;

  const emit = (text: string) => {
    if (pendingFallback > 0) {
      pendingFallback -= 1;
      return;
    }
    if (!skip) out += text;
  };

  while (i < rtf.length) {
    const char = rtf[i];
    if (char === '{') {
      stack.push({ skip, fallback });
      i++;
    } else if (char === '}') {
      const state = stack.pop();
      if (state) ({ skip, fallback } = state);
      pendingFallback = 0;
      i++;
    } else if (char === '\\') {
      const next = rtf[i + 1] ?? '';
      if (next === "'") {
        emit(cp1252Char(parseInt(rtf.slice(i + 2, i + 4), 16) || 0x3f));
        i += 4;
      } else if (next === '*') {
        skip = true;
        i += 2;
      } else if (next === '\n' || next === '\r') {
        emit('\n');
        i += 2;
      } else if (next === '~') {
        emit(' ');
        i += 2;
      } else if (!/[a-zA-Z]/.test(next)) {
        // `\\`, `\{`, `\}` : caractère littéral ; `\-`, `\_` et autres : ignorés.
        if ('\\{}'.includes(next)) emit(next);
        i += 2;
      } else {
        const word = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i + 1))!;
        const [, name, parameter] = word;
        i += 1 + word[0].length;
        if (RTF_SKIPPED.has(name)) {
          skip = true;
        } else if (name === 'uc') {
          fallback = Number(parameter ?? 1);
        } else if (name === 'u' && parameter !== undefined) {
          const code = Number(parameter);
          emit(String.fromCharCode(code < 0 ? code + 65536 : code));
          pendingFallback = fallback;
        } else if (name in RTF_SYMBOLS) {
          emit(RTF_SYMBOLS[name]);
        }
      }
    } else if (char === '\n' || char === '\r') {
      i++;
    } else {
      emit(char);
      i++;
    }
  }
  return out.replace(/\n+$/, '');
}

const extensionOf = (fileName: string) => /\.([^./\\]+)$/.exec(fileName)?.[1].toLowerCase() ?? '';

/** Titre proposé pour un fichier : son nom sans extension. */
export function titleOfFile(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '').trim();
}

/**
 * Note tirée d'un fichier texte, selon son extension.
 * @throws ImportError si le fichier est trop gros ou n'est pas du texte.
 */
export function fileToNote(fileName: string, bytes: Uint8Array): { title: string; doc: RichNode } {
  if (bytes.length > MAX_IMPORT_BYTES) {
    throw new ImportError('Ce fichier est trop volumineux (2 Mo au maximum).');
  }
  const text = decodeText(bytes);
  const extension = extensionOf(fileName);
  if (extension === 'md' || extension === 'markdown' || extension === 'mdown') {
    return markdownToNote(text, fileName);
  }
  const isRtf = extension === 'rtf' || text.startsWith('{\\rtf');
  const plain = (isRtf ? rtfToText(text) : text).replace(/\n+$/, '');
  return { title: titleOfFile(fileName), doc: docFromPlainText(plain) };
}
