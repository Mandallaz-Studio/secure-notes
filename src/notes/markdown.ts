import type { RichMark, RichNode } from '@/notes/rich-text';

/**
 * Conversion entre le document de l'éditeur et Markdown.
 *
 * Markdown ne sait pas tout dire : le souligné passe par `<u>`, le surlignage
 * par `==texte==` (sa couleur est perdue) et la couleur du texte est perdue.
 * L'éditeur n'a ni bloc de code ni ligne de séparation : à l'import, un bloc
 * de code devient un paragraphe en police de code et les séparations sont
 * ignorées. Une image est exportée avec son contenu (`![](data:…)`).
 */

// --- Export ---------------------------------------------------------------

/** Ordre d'imbrication des marques, de l'extérieur vers l'intérieur. */
const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'underline', 'highlight', 'code'];

function markDelimiters(mark: RichMark): [string, string] | null {
  switch (mark.type) {
    case 'bold':
      return ['**', '**'];
    case 'italic':
      return ['*', '*'];
    case 'strike':
      return ['~~', '~~'];
    case 'underline':
      return ['<u>', '</u>'];
    case 'highlight':
      return ['==', '=='];
    case 'code':
      return ['`', '`'];
    case 'link':
      return ['[', `](${String(mark.attrs?.href ?? '')})`];
    default:
      return null;
  }
}

function escapeText(text: string): string {
  return text.replace(/[\\*_`[]/g, '\\$&');
}

/** Empêche un début de ligne d'être lu comme un titre, une liste ou une citation. */
function escapeLineStart(line: string): string {
  return line.replace(/^(\s*)(#{1,6}\s|>|[-+]\s|\d+[.)]\s)/, (_, space: string, marker: string) =>
    marker.startsWith('#') || marker.startsWith('>') || /^[-+]/.test(marker)
      ? `${space}\\${marker}`
      : `${space}${marker.replace(/([.)])/, '\\$1')}`,
  );
}

function sameMark(a: RichMark, b: RichMark): boolean {
  return a.type === b.type && a.attrs?.href === b.attrs?.href;
}

function inlineToMarkdown(nodes: RichNode[] = []): string {
  let out = '';
  let open: RichMark[] = [];
  const closeFrom = (index: number) => {
    for (let i = open.length - 1; i >= index; i--) out += markDelimiters(open[i])![1];
    open = open.slice(0, index);
  };

  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      closeFrom(0);
      out += '  \n';
      continue;
    }
    if (node.type !== 'text') continue;
    const wanted = (node.marks ?? [])
      .filter((mark) => markDelimiters(mark) !== null)
      .sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    let common = 0;
    while (common < open.length && common < wanted.length && sameMark(open[common], wanted[common])) {
      common++;
    }
    closeFrom(common);
    for (const mark of wanted.slice(common)) {
      out += markDelimiters(mark)![0];
      open.push(mark);
    }
    const isCode = wanted.some((mark) => mark.type === 'code');
    out += isCode ? (node.text ?? '') : escapeText(node.text ?? '');
  }
  closeFrom(0);
  return out;
}

function indent(text: string, prefix: string, firstPrefix = prefix): string {
  return text
    .split('\n')
    .map((line, index) => (index === 0 ? firstPrefix : line === '' ? '' : prefix) + line)
    .join('\n');
}

function listToMarkdown(node: RichNode): string {
  const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1;
  return (node.content ?? [])
    .map((item, index) => {
      const marker =
        node.type === 'orderedList'
          ? `${start + index}. `
          : node.type === 'taskList'
            ? `- [${item.attrs?.checked ? 'x' : ' '}] `
            : '- ';
      const body = blocksToMarkdown(item.content ?? [], '\n');
      return indent(body, ' '.repeat(marker.length), marker);
    })
    .join('\n');
}

function blockToMarkdown(node: RichNode): string {
  switch (node.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      return `${'#'.repeat(level)} ${inlineToMarkdown(node.content)}`;
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return listToMarkdown(node);
    case 'blockquote':
      return blocksToMarkdown(node.content ?? [], '\n\n')
        .split('\n')
        .map((line) => (line === '' ? '>' : `> ${line}`))
        .join('\n');
    case 'image':
      return `![${escapeText(String(node.attrs?.alt ?? ''))}](${String(node.attrs?.src ?? '')})`;
    case 'paragraph':
      return inlineToMarkdown(node.content).split('\n').map(escapeLineStart).join('\n');
    default:
      return blocksToMarkdown(node.content ?? [], '\n\n');
  }
}

function blocksToMarkdown(nodes: RichNode[], separator: string): string {
  return nodes.map(blockToMarkdown).join(separator);
}

export function docToMarkdown(doc: RichNode): string {
  return blocksToMarkdown(doc.content ?? [], '\n\n').replace(/\n+$/, '');
}

/** Fichier Markdown d'une note : le titre en titre de niveau 1, puis le contenu. */
export function noteToMarkdown(title: string, doc: RichNode): string {
  const body = docToMarkdown(doc);
  const heading = title.trim() === '' ? '' : `# ${escapeText(title.trim())}`;
  return `${[heading, body].filter((part) => part !== '').join('\n\n')}\n`;
}

/** Nom de fichier sûr tiré du titre d'une note. */
export function markdownFileName(title: string): string {
  const base = title
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base === '' ? 'note' : base}.md`;
}

// --- Import ---------------------------------------------------------------

const HIGHLIGHT_ON_IMPORT = 'palette:yellow';

type InlineRule = {
  pattern: RegExp;
  /** Marque posée sur le texte capturé ; `null` : texte littéral. */
  mark: (match: RegExpExecArray) => RichMark | null;
  /** Le texte capturé n'est pas analysé plus avant (code). */
  literal?: boolean;
};

const INLINE_RULES: InlineRule[] = [
  { pattern: /^`([^`]+)`/, mark: () => ({ type: 'code' }), literal: true },
  { pattern: /^\*\*(?=\S)([\s\S]+?)\*\*/, mark: () => ({ type: 'bold' }) },
  { pattern: /^__(?=\S)([\s\S]+?)__(?!\w)/, mark: () => ({ type: 'bold' }) },
  { pattern: /^\*(?=\S)([\s\S]+?)\*(?!\*)/, mark: () => ({ type: 'italic' }) },
  { pattern: /^_(?=\S)([\s\S]+?)_(?!\w)/, mark: () => ({ type: 'italic' }) },
  { pattern: /^~~(?=\S)([\s\S]+?)~~/, mark: () => ({ type: 'strike' }) },
  {
    pattern: /^==(?=\S)([\s\S]+?)==/,
    mark: () => ({ type: 'highlight', attrs: { color: HIGHLIGHT_ON_IMPORT } }),
  },
  { pattern: /^<u>([\s\S]+?)<\/u>/i, mark: () => ({ type: 'underline' }) },
  {
    pattern: /^\[([^\]]+)\]\(([^)\s]+)\)/,
    mark: (match) => ({ type: 'link', attrs: { href: match[2] } }),
  },
];

function parseInline(text: string, marks: RichMark[] = []): RichNode[] {
  const nodes: RichNode[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer === '') return;
    nodes.push({ type: 'text', text: buffer, ...(marks.length > 0 ? { marks } : {}) });
    buffer = '';
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '\\' && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!>~=|]/.test(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    if (char === '\n') {
      flush();
      nodes.push({ type: 'hardBreak' });
      i++;
      continue;
    }
    // Un `_` au milieu d'un mot (nom_de_variable) n'ouvre pas d'italique.
    const insideWord = char === '_' && i > 0 && /\w/.test(text[i - 1]);
    const rest = text.slice(i);
    let matched = false;
    if (!insideWord) {
      for (const rule of INLINE_RULES) {
        const match = rule.pattern.exec(rest);
        if (!match) continue;
        const mark = rule.mark(match);
        flush();
        const inner = mark ? [...marks, mark] : marks;
        if (rule.literal) nodes.push({ type: 'text', text: match[1], marks: inner });
        else nodes.push(...parseInline(match[1], inner));
        i += match[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      buffer += char;
      i++;
    }
  }
  flush();
  return nodes;
}

function paragraph(text: string): RichNode {
  const content = parseInline(text);
  return { type: 'paragraph', ...(content.length > 0 ? { content } : {}) };
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*(```|~~~)/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
/**
 * Image seule sur sa ligne. Seules les images incluses dans le fichier sont
 * reprises : une adresse distante ferait sortir une requête de l'app à chaque
 * ouverture de la note.
 */
const IMAGE = /^\s{0,3}!\[([^\]]*)\]\((data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+)\)\s*$/;

function parseList(lines: string[], start: number): { node: RichNode; next: number } {
  const first = LIST_ITEM.exec(lines[start])!;
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const firstIsTask = TASK.test(first[4]);
  const items: { lines: string[] }[] = [];
  let i = start;

  while (i < lines.length) {
    const match = LIST_ITEM.exec(lines[i]);
    if (!match || match[1].length !== baseIndent || /\d/.test(match[2]) !== ordered) break;
    // Une case à cocher qui apparaît ou disparaît commence une autre liste.
    if (TASK.test(match[4]) !== firstIsTask) break;
    const contentIndent = match[1].length + match[2].length + match[3].length;
    const itemLines = [match[4]];
    i++;
    // Suite de l'élément : lignes plus indentées, lignes vides comprises si la suite l'est.
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') {
        const following = lines.slice(i + 1).find((candidate) => candidate.trim() !== '');
        if (following === undefined || following.search(/\S/) <= baseIndent) break;
        itemLines.push('');
        i++;
      } else if (line.search(/\S/) > baseIndent) {
        itemLines.push(line.slice(Math.min(contentIndent, line.search(/\S/))));
        i++;
      } else {
        break;
      }
    }
    items.push({ lines: itemLines });
    // Une ligne vide entre deux éléments ne coupe pas la liste.
    let peek = i;
    while (peek < lines.length && lines[peek].trim() === '') peek++;
    const nextItem = peek < lines.length ? LIST_ITEM.exec(lines[peek]) : null;
    if (nextItem && nextItem[1].length === baseIndent) i = peek;
  }

  const tasks = items.map((item) => TASK.exec(item.lines[0]));
  const isTaskList = !ordered && tasks.every((task) => task !== null);
  const toContent = (itemLines: string[]): RichNode[] => {
    const blocks = parseBlocks(itemLines);
    // Un élément de liste commence toujours par un paragraphe.
    return blocks[0]?.type === 'paragraph' ? blocks : [{ type: 'paragraph' }, ...blocks];
  };

  const node: RichNode = isTaskList
    ? {
        type: 'taskList',
        content: items.map((item, index) => ({
          type: 'taskItem',
          attrs: { checked: tasks[index]![1] !== ' ' },
          content: toContent([tasks[index]![2], ...item.lines.slice(1)]),
        })),
      }
    : {
        type: ordered ? 'orderedList' : 'bulletList',
        ...(ordered ? { attrs: { start: parseInt(first[2], 10) } } : {}),
        content: items.map((item) => ({ type: 'listItem', content: toContent(item.lines) })),
      };
  return { node, next: i };
}

function parseBlocks(lines: string[]): RichNode[] {
  const blocks: RichNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || RULE.test(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      i++; // ligne de fermeture
      const content: RichNode[] = [];
      code.forEach((codeLine, index) => {
        if (index > 0) content.push({ type: 'hardBreak' });
        if (codeLine !== '') content.push({ type: 'text', text: codeLine, marks: [{ type: 'code' }] });
      });
      blocks.push({ type: 'paragraph', ...(content.length > 0 ? { content } : {}) });
      continue;
    }

    const image = IMAGE.exec(line);
    if (image) {
      blocks.push({ type: 'image', attrs: { src: image[2], alt: image[1] || null, title: null } });
      i++;
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const content = parseInline(heading[2]);
      blocks.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        ...(content.length > 0 ? { content } : {}),
      });
      i++;
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        quoted.push(lines[i++].replace(/^\s{0,3}> ?/, ''));
      }
      const content = parseBlocks(quoted);
      blocks.push({ type: 'blockquote', content: content.length > 0 ? content : [{ type: 'paragraph' }] });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const { node, next } = parseList(lines, i);
      blocks.push(node);
      i = next;
      continue;
    }

    // Paragraphe : lignes consécutives. Deux espaces ou `\` en fin de ligne = saut de ligne.
    let text = '';
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !FENCE.test(lines[i]) &&
      !/^\s{0,3}(#{1,6}\s|>)/.test(lines[i]) &&
      !(text !== '' && (LIST_ITEM.test(lines[i]) || RULE.test(lines[i])))
    ) {
      const current = lines[i++];
      const hardBreak = / {2,}$/.test(current) || /\\$/.test(current);
      text += current.replace(/( {2,}|\\)$/, '').trim() + (hardBreak ? '\n' : ' ');
    }
    blocks.push(paragraph(text.replace(/[ \n]$/, '')));
  }
  return blocks;
}

export function markdownToDoc(markdown: string): RichNode {
  const lines = markdown.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const content = parseBlocks(lines);
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

/**
 * Note tirée d'un fichier Markdown. Le titre est le premier titre de niveau 1
 * s'il ouvre le fichier, sinon le nom du fichier sans son extension.
 */
export function markdownToNote(markdown: string, fileName: string): { title: string; doc: RichNode } {
  const doc = markdownToDoc(markdown);
  const [first, ...rest] = doc.content ?? [];
  if (first?.type === 'heading' && first.attrs?.level === 1) {
    const title = (first.content ?? []).map((node) => node.text ?? '').join('');
    return { title, doc: { type: 'doc', content: rest.length > 0 ? rest : [{ type: 'paragraph' }] } };
  }
  return { title: fileName.replace(/\.[^./\\]+$/, ''), doc };
}
