import { NotePalette } from '@/constants/theme';
import {
  docToMarkdown,
  markdownFileName,
  markdownToDoc,
  markdownToNote,
  noteToMarkdown,
} from '@/notes/markdown';
import {
  contentOfDoc,
  docFromPlainText,
  docOfContent,
  parseDoc,
  plainTextOf,
  toDisplayDoc,
  toStoredDoc,
  type RichNode,
} from '@/notes/rich-text';

const text = (value: string, ...marks: string[]): RichNode => ({
  type: 'text',
  text: value,
  ...(marks.length > 0 ? { marks: marks.map((type) => ({ type })) } : {}),
});
const p = (...content: RichNode[]): RichNode => ({ type: 'paragraph', content });
const doc = (...content: RichNode[]): RichNode => ({ type: 'doc', content });

describe('texte brut', () => {
  it('fait un paragraphe par ligne et revient au même texte', () => {
    const source = 'Pain\n\nBeurre';
    const converted = docFromPlainText(source);
    expect(converted.content).toHaveLength(3);
    expect(plainTextOf(converted)).toBe(source);
  });

  it('extrait le texte des titres, listes et citations', () => {
    const rich = doc(
      { type: 'heading', attrs: { level: 1 }, content: [text('Titre')] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [p(text('un'))] },
          { type: 'listItem', content: [p(text('deux', 'bold'))] },
        ],
      },
      { type: 'blockquote', content: [p(text('cité'))] },
    );
    expect(plainTextOf(rich)).toBe('Titre\nun\ndeux\ncité');
  });

  it('refuse un document illisible', () => {
    expect(parseDoc('pas du json')).toBeNull();
    expect(parseDoc('{"type":"paragraph"}')).toBeNull();
    expect(parseDoc('{"type":"doc","content":[]}')).toEqual({ type: 'doc', content: [] });
  });
});

describe('couleurs par jetons', () => {
  const colored = (color: string, highlight: string) =>
    doc(
      p({
        type: 'text',
        text: 'rouge',
        marks: [
          { type: 'textStyle', attrs: { color } },
          { type: 'highlight', attrs: { color: highlight } },
        ],
      }),
    );

  it('stocke le même jeton quel que soit le thème de saisie', () => {
    const fromLight = toStoredDoc(
      colored(NotePalette.light.text.red, NotePalette.light.highlight.yellow),
    );
    const fromDark = toStoredDoc(
      colored(NotePalette.dark.text.red.toLowerCase(), NotePalette.dark.highlight.yellow),
    );
    expect(fromLight).toEqual(colored('palette:red', 'palette:yellow'));
    expect(fromDark).toEqual(fromLight);
  });

  it('reconnaît une couleur écrite en rgb()', () => {
    expect(toStoredDoc(colored('rgb(206, 44, 49)', '#FFF3A3'))).toEqual(
      colored('palette:red', 'palette:yellow'),
    );
  });

  it('affiche la teinte du thème demandé', () => {
    const stored = colored('palette:red', 'palette:yellow');
    expect(toDisplayDoc(stored, 'dark')).toEqual(
      colored(NotePalette.dark.text.red, NotePalette.dark.highlight.yellow),
    );
    expect(toDisplayDoc(stored, 'light')).toEqual(
      colored(NotePalette.light.text.red, NotePalette.light.highlight.yellow),
    );
  });

  it('conserve une couleur hors palette et neutralise un jeton inconnu', () => {
    expect(toStoredDoc(colored('#123456', '#654321'))).toEqual(colored('#123456', '#654321'));
    expect(toDisplayDoc(colored('palette:disparu', 'palette:yellow'), 'light')).toEqual(
      colored('inherit', NotePalette.light.highlight.yellow),
    );
  });

  it('ne modifie pas le document reçu', () => {
    const original = colored(NotePalette.light.text.red, NotePalette.light.highlight.yellow);
    const copy = JSON.parse(JSON.stringify(original));
    toStoredDoc(original);
    expect(original).toEqual(copy);
  });
});

describe('export Markdown', () => {
  it('écrit titres, marques et listes', () => {
    const rich = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Section')] },
      p(
        text('Du '),
        text('gras', 'bold'),
        text(', '),
        text('italique', 'italic'),
        text(', '),
        text('barré', 'strike'),
        text(', '),
        text('souligné', 'underline'),
        text(' et '),
        text('code', 'code'),
        text('.'),
      ),
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [
          { type: 'listItem', content: [p(text('un'))] },
          {
            type: 'listItem',
            content: [
              p(text('deux')),
              { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('sous'))] }] },
            ],
          },
        ],
      },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [p(text('fait'))] },
          { type: 'taskItem', attrs: { checked: false }, content: [p(text('à faire'))] },
        ],
      },
      { type: 'blockquote', content: [p(text('cité'))] },
    );
    expect(docToMarkdown(rich)).toBe(
      [
        '## Section',
        '',
        'Du **gras**, *italique*, ~~barré~~, <u>souligné</u> et `code`.',
        '',
        '1. un',
        '2. deux',
        '   - sous',
        '',
        '- [x] fait',
        '- [ ] à faire',
        '',
        '> cité',
      ].join('\n'),
    );
  });

  it('ne répète pas une marque partagée par des textes voisins', () => {
    const rich = doc(p(text('a', 'bold'), text('b', 'bold', 'italic'), text('c', 'bold')));
    expect(docToMarkdown(rich)).toBe('**a*b*c**');
  });

  it('échappe ce qui serait lu comme de la mise en forme', () => {
    expect(docToMarkdown(doc(p(text('2 * 3 = 6 et nom_de_fichier'))))).toBe(
      '2 \\* 3 = 6 et nom\\_de\\_fichier',
    );
    expect(docToMarkdown(doc(p(text('# pas un titre'))))).toBe('\\# pas un titre');
    expect(docToMarkdown(doc(p(text('- pas une liste'))))).toBe('\\- pas une liste');
    expect(docToMarkdown(doc(p(text('1. pas une liste'))))).toBe('1\\. pas une liste');
  });

  it('met le titre de la note en tête', () => {
    expect(noteToMarkdown('Courses', doc(p(text('Pain'))))).toBe('# Courses\n\nPain\n');
    expect(noteToMarkdown('', doc(p(text('Pain'))))).toBe('Pain\n');
  });

  it('tire un nom de fichier sûr du titre', () => {
    expect(markdownFileName('Réunion 12/03 : bilan ?')).toBe('Réunion 12 03 bilan.md');
    expect(markdownFileName('   ')).toBe('note.md');
  });
});

describe('import Markdown', () => {
  it('lit titres, marques, listes, tâches et citations', () => {
    const imported = markdownToDoc(
      [
        '## Section',
        '',
        'Du **gras**, *italique*, ~~barré~~, <u>souligné</u>, ==surligné== et `code`.',
        '',
        '1. un',
        '2. deux',
        '   - sous',
        '',
        '- [x] fait',
        '- [ ] à faire',
        '',
        '> cité',
      ].join('\n'),
    );
    expect(imported.content?.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'orderedList',
      'taskList',
      'blockquote',
    ]);
    const marks = imported.content![1].content!.flatMap((node) =>
      (node.marks ?? []).map((mark) => `${node.text}:${mark.type}`),
    );
    expect(marks).toEqual([
      'gras:bold',
      'italique:italic',
      'barré:strike',
      'souligné:underline',
      'surligné:highlight',
      'code:code',
    ]);
    const second = imported.content![2].content![1];
    expect(second.content?.map((node) => node.type)).toEqual(['paragraph', 'bulletList']);
    expect(imported.content![3].content?.map((item) => item.attrs?.checked)).toEqual([true, false]);
    expect(plainTextOf(imported)).toBe(
      'Section\nDu gras, italique, barré, souligné, surligné et code.\nun\ndeux\nsous\nfait\nà faire\ncité',
    );
  });

  it('sépare une liste de tâches de la liste à puces qui la précède', () => {
    const imported = markdownToDoc('- un\n- deux\n\n- [x] fait\n- [ ] à faire\n- trois');
    expect(imported.content?.map((node) => node.type)).toEqual([
      'bulletList',
      'taskList',
      'bulletList',
    ]);
  });

  it('lit liens, échappements et soulignés dans les mots', () => {
    const [paragraph] = markdownToDoc('[site](https://exemple.fr) 2 \\* 3 nom_de_fichier').content!;
    expect(paragraph.content).toEqual([
      { type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://exemple.fr' } }] },
      { type: 'text', text: ' 2 * 3 nom_de_fichier' },
    ]);
  });

  it('transforme un bloc de code en paragraphe de code et ignore les séparations', () => {
    const imported = markdownToDoc('```js\nconst a = 1;\nconst b = 2;\n```\n\n---\n\nfin');
    expect(imported.content).toEqual([
      p(text('const a = 1;', 'code'), { type: 'hardBreak' }, text('const b = 2;', 'code')),
      p(text('fin')),
    ]);
  });

  it('joint les lignes d’un paragraphe et respecte les sauts de ligne forcés', () => {
    expect(markdownToDoc('une\ndeux  \ntrois').content).toEqual([
      p(text('une deux'), { type: 'hardBreak' }, text('trois')),
    ]);
  });

  it('prend le premier titre de niveau 1 comme titre de la note', () => {
    expect(markdownToNote('# Courses\n\nPain', 'fichier.md')).toEqual({
      title: 'Courses',
      doc: doc(p(text('Pain'))),
    });
    expect(markdownToNote('Pain', 'liste.md')).toEqual({ title: 'liste', doc: doc(p(text('Pain'))) });
  });

  it('retrouve le même document après un aller-retour', () => {
    const source = [
      '## Section',
      '',
      'Du **gras *et italique*** puis ~~barré~~.',
      '',
      '- un',
      '- deux',
      '  1. sous',
      '',
      '> cité',
    ].join('\n');
    const once = markdownToDoc(source);
    expect(markdownToDoc(docToMarkdown(once))).toEqual(once);
  });
});

describe('contenu enregistré', () => {
  it('ouvre une note en texte brut comme un document', () => {
    const opened = docOfContent({ body: 'un\ndeux', bodyFormat: 'text', plainText: 'un\ndeux' });
    expect(plainTextOf(opened)).toBe('un\ndeux');
  });

  it('enregistre le document avec ses jetons et son texte', () => {
    const edited = doc(
      p({
        type: 'text',
        text: 'rouge',
        marks: [{ type: 'textStyle', attrs: { color: NotePalette.dark.text.red } }],
      }),
    );
    const saved = contentOfDoc(edited);
    expect(saved.bodyFormat).toBe('tiptap');
    expect(saved.plainText).toBe('rouge');
    expect(saved.body).toContain('palette:red');
    expect(docOfContent(saved)).toEqual(toStoredDoc(edited));
  });

  it('retombe sur le texte si le document est illisible', () => {
    const opened = docOfContent({ body: '{cassé', bodyFormat: 'tiptap', plainText: 'secours' });
    expect(plainTextOf(opened)).toBe('secours');
  });
});
