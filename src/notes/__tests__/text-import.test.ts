import { docToMarkdown, markdownToDoc } from '@/notes/markdown';
import { contentOfDoc, plainTextOf, type RichNode } from '@/notes/rich-text';
import { decodeText, fileToNote, ImportError, rtfToText, titleOfFile } from '@/notes/text-import';

const utf8 = (text: string) => new TextEncoder().encode(text);
const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';
const image: RichNode = { type: 'image', attrs: { src: PIXEL, alt: null, title: null } };

describe('décodage du texte', () => {
  it("lit l'UTF-8, avec ou sans marque d'ordre", () => {
    expect(decodeText(utf8('Été 🙂'))).toBe('Été 🙂');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Été')]))).toBe('Été');
  });

  it("lit l'UTF-16 avec marque d'ordre", () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0xe9, 0x00, 0x74, 0x00]))).toBe('ét');
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0xe9, 0x00, 0x74]))).toBe('ét');
  });

  it('se replie sur Windows-1252 quand ce n’est pas de l’UTF-8', () => {
    expect(decodeText(new Uint8Array([0xe9, 0x74, 0xe9, 0x20, 0x80, 0x92]))).toBe('été €’');
  });

  it('unifie les fins de ligne', () => {
    expect(decodeText(utf8('a\r\nb\rc\n'))).toBe('a\nb\nc\n');
  });

  it('refuse un fichier binaire', () => {
    expect(() => decodeText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))).toThrow(
      ImportError,
    );
  });

  it('lit un long fichier', () => {
    const long = 'ligne é\n'.repeat(20000);
    expect(decodeText(utf8(long))).toBe(long);
  });
});

describe('RTF', () => {
  it('garde le texte et retire la mise en forme', () => {
    const rtf =
      '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red255\\green0\\blue0;}' +
      '{\\*\\generator Riched20;}\\f0\\fs24 Bonjour {\\b tout} le monde\\par\n' +
      "\\'e9t\\'e9 \\u8364? \\{ok\\}\\tab fin\\par}";
    expect(rtfToText(rtf)).toBe('Bonjour tout le monde\nété € {ok}\tfin');
  });
});

describe('fichier vers note', () => {
  it('convertit le Markdown', () => {
    const { title, doc } = fileToNote('courses.md', utf8('# Liste\n\n**Pain**'));
    expect(title).toBe('Liste');
    expect(doc.content?.[0].content?.[0].marks).toEqual([{ type: 'bold' }]);
  });

  it('garde tel quel un fichier texte, une ligne par paragraphe', () => {
    const { title, doc } = fileToNote('notes.2026.txt', utf8('# pas un titre\n\n- un\n'));
    expect(title).toBe('notes.2026');
    expect(doc.content?.map((node) => node.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(plainTextOf(doc)).toBe('# pas un titre\n\n- un');
  });

  it('accepte les autres formats texte', () => {
    expect(plainTextOf(fileToNote('data.csv', utf8('a;b\n1;2')).doc)).toBe('a;b\n1;2');
    expect(plainTextOf(fileToNote('conf.json', utf8('{"a": 1}')).doc)).toBe('{"a": 1}');
    expect(plainTextOf(fileToNote('LISEZMOI', utf8('sans extension')).doc)).toBe('sans extension');
  });

  it('reconnaît le RTF à son extension ou à son contenu', () => {
    expect(plainTextOf(fileToNote('lettre.rtf', utf8('{\\rtf1 Bonjour\\par}')).doc)).toBe('Bonjour');
    expect(plainTextOf(fileToNote('lettre.txt', utf8('{\\rtf1 Bonjour\\par}')).doc)).toBe('Bonjour');
  });

  it('refuse un fichier trop gros ou binaire', () => {
    expect(() => fileToNote('gros.txt', new Uint8Array(2 * 1024 * 1024 + 1))).toThrow(ImportError);
    expect(() => fileToNote('photo.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toThrow(
      ImportError,
    );
  });

  it('tire le titre du nom du fichier', () => {
    expect(titleOfFile('rapport final.docx.txt')).toBe('rapport final.docx');
    expect(titleOfFile('sans-extension')).toBe('sans-extension');
  });
});

describe('images', () => {
  it("une note qui ne contient qu'une image n'est pas vide", () => {
    const content = contentOfDoc({ type: 'doc', content: [image] });
    expect(content.plainText).toBe('[image]');
    expect(JSON.parse(content.body).content[0].attrs.src).toBe(PIXEL);
  });

  it('fait l’aller-retour par Markdown', () => {
    const doc: RichNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'avant' }] }, image],
    };
    const markdown = docToMarkdown(doc);
    expect(markdown).toBe(`avant\n\n![](${PIXEL})`);
    expect(markdownToDoc(markdown)).toEqual(doc);
  });

  it("n'importe pas une image distante", () => {
    const doc = markdownToDoc('![logo](https://example.com/logo.png)');
    expect(JSON.stringify(doc)).not.toContain('"image"');
  });
});
