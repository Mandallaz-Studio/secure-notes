import { NotePalette, type ColorScheme } from '@/constants/theme';

/** Nœud d'un document TipTap, tel que l'éditeur le sérialise en JSON. */
export type RichNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: RichMark[];
  text?: string;
};

export type RichMark = { type: string; attrs?: Record<string, unknown> };

/** Préfixe d'une couleur stockée sous forme de jeton de palette : `palette:red`. */
const TOKEN_PREFIX = 'palette:';

/** Marque portant une couleur, et groupe de la palette où chercher son jeton. */
const COLOR_MARKS: Record<string, 'text' | 'highlight'> = {
  textStyle: 'text',
  highlight: 'highlight',
};

export const EMPTY_DOC: RichNode = { type: 'doc', content: [{ type: 'paragraph' }] };

/** Document équivalent à un texte brut : un paragraphe par ligne. */
export function docFromPlainText(text: string): RichNode {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      ...(line === '' ? {} : { content: [{ type: 'text', text: line }] }),
    })),
  };
}

/** Lit un document sérialisé ; `null` s'il est illisible. */
export function parseDoc(body: string): RichNode | null {
  try {
    const doc: unknown = JSON.parse(body);
    if (typeof doc === 'object' && doc !== null && (doc as RichNode).type === 'doc') {
      return doc as RichNode;
    }
  } catch {
    // Traité comme illisible ci-dessous.
  }
  return null;
}

const BLOCKS_WITH_OWN_LINE = new Set(['paragraph', 'heading']);

/** Ce qui tient lieu de texte pour une image, dans l'aperçu et la recherche. */
export const IMAGE_PLACEHOLDER = '[image]';

/** Texte brut du document, une ligne par bloc : sert à l'aperçu et à la recherche. */
export function plainTextOf(doc: RichNode): string {
  const lines: string[] = [];
  const inline = (node: RichNode): string => {
    if (node.type === 'text') return node.text ?? '';
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'image') return IMAGE_PLACEHOLDER;
    return (node.content ?? []).map(inline).join('');
  };
  const walk = (node: RichNode) => {
    if (node.type === 'image') lines.push(IMAGE_PLACEHOLDER);
    else if (BLOCKS_WITH_OWN_LINE.has(node.type)) lines.push(inline(node));
    else (node.content ?? []).forEach(walk);
  };
  walk(doc);
  return lines.join('\n').replace(/\n+$/, '');
}

/** `#abc`, `#AABBCC` ou `rgb(r, g, b)` → `#aabbcc` ; autre chose → `null`. */
function normalizeColor(color: string): string | null {
  const value = color.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(value);
  if (rgb) {
    return `#${rgb
      .slice(1)
      .map((part) => Number(part).toString(16).padStart(2, '0'))
      .join('')}`;
  }
  return null;
}

function tokenOf(color: string, group: 'text' | 'highlight'): string | null {
  const normalized = normalizeColor(color);
  if (!normalized) return null;
  for (const scheme of ['light', 'dark'] as const) {
    for (const [token, value] of Object.entries(NotePalette[scheme][group])) {
      if (value.toLowerCase() === normalized) return token;
    }
  }
  return null;
}

function mapColors(
  node: RichNode,
  convert: (color: string, group: 'text' | 'highlight') => string,
): RichNode {
  const next: RichNode = { ...node };
  if (node.content) next.content = node.content.map((child) => mapColors(child, convert));
  if (node.marks) {
    next.marks = node.marks.map((mark) => {
      const group = COLOR_MARKS[mark.type];
      const color = mark.attrs?.color;
      if (!group || typeof color !== 'string') return mark;
      return { ...mark, attrs: { ...mark.attrs, color: convert(color, group) } };
    });
  }
  return next;
}

/**
 * Forme stockée : les couleurs de la palette deviennent des jetons
 * (`palette:red`), quelle que soit la teinte du thème dans lequel elles ont
 * été posées. Une couleur hors palette est conservée telle quelle.
 */
export function toStoredDoc(doc: RichNode): RichNode {
  return mapColors(doc, (color, group) => {
    if (color.startsWith(TOKEN_PREFIX)) return color;
    const token = tokenOf(color, group);
    return token ? `${TOKEN_PREFIX}${token}` : color;
  });
}

/** Forme affichée : chaque jeton prend la teinte du thème courant. */
export function toDisplayDoc(doc: RichNode, scheme: ColorScheme): RichNode {
  return mapColors(doc, (color, group) => {
    if (!color.startsWith(TOKEN_PREFIX)) return color;
    const palette: Record<string, string> = NotePalette[scheme][group];
    // Jeton inconnu (palette modifiée depuis) : couleur héritée du texte.
    return palette[color.slice(TOKEN_PREFIX.length)] ?? 'inherit';
  });
}

type SerializedBody = { body: string; bodyFormat: 'text' | 'tiptap'; plainText: string };

/** Document (forme stockée) d'une note, qu'elle soit en texte brut ou mise en forme. */
export function docOfContent(content: SerializedBody): RichNode {
  if (content.bodyFormat === 'tiptap') {
    // Document illisible : on retombe sur le texte, qui est toujours conservé à part.
    return parseDoc(content.body) ?? docFromPlainText(content.plainText);
  }
  return docFromPlainText(content.body);
}

/** Contenu à enregistrer pour un document sorti de l'éditeur. */
export function contentOfDoc(doc: RichNode): SerializedBody {
  const stored = toStoredDoc(doc);
  return { body: JSON.stringify(stored), bodyFormat: 'tiptap', plainText: plainTextOf(stored) };
}
