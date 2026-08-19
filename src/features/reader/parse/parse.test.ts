import { test, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseEpub } from './epub';
import { parseFb2 } from './fb2';
import { parseDocx } from './docx';
import { detectFormat } from './index';
import { htmlToText, toSentences } from './text';

test('detectFormat maps extensions, ignores pdf/mobi', () => {
  expect(detectFormat('a.epub')).toBe('epub');
  expect(detectFormat('a.FB2')).toBe('fb2');
  expect(detectFormat('book.fb2.zip')).toBe('fb2');
  expect(detectFormat('a.docx')).toBe('docx');
  expect(detectFormat('a.pdf')).toBeNull();
  expect(detectFormat('a.mobi')).toBeNull();
});

test('htmlToText separates block elements into paragraphs', () => {
  const text = htmlToText('<html><body><h1>Title</h1><p>One two.</p><p>Three four.</p></body></html>');
  expect(text.split(/\n{2,}/)).toEqual(['Title', 'One two.', 'Three four.']);
});

test('toSentences splits on terminal punctuation', () => {
  expect(toSentences('Hello world. This is a test! Really?')).toEqual([
    'Hello world.',
    'This is a test!',
    'Really?',
  ]);
});

test('parseEpub reads title, author and spine order', () => {
  const opf = `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>My Book</dc:title><dc:creator>Jane Doe</dc:creator></metadata>
      <manifest>
        <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
    </package>`;
  const container = `<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`;
  const zip = zipSync({
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/ch1.xhtml': strToU8('<html><body><p>The first chapter is here for reading.</p></body></html>'),
    'OEBPS/ch2.xhtml': strToU8('<html><body><p>The second chapter continues the story nicely.</p></body></html>'),
  });
  const book = parseEpub(zip);
  expect(book.title).toBe('My Book');
  expect(book.author).toBe('Jane Doe');
  expect(book.chapters.length).toBe(2);
  expect(book.chapters[0]!.text).toContain('first chapter');
  expect(book.chapters[1]!.text).toContain('second chapter');
});

test('parseFb2 reads title, author and sections', () => {
  const fb2 = `<?xml version="1.0" encoding="utf-8"?>
    <FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
      <description><title-info>
        <book-title>Winter Tale</book-title>
        <author><first-name>Ivan</first-name><last-name>Petrov</last-name></author>
      </title-info></description>
      <body>
        <section><title><p>Chapter One</p></title><p>It was a cold and quiet morning.</p></section>
        <section><p>Later the sun came out over the hills.</p></section>
      </body>
    </FictionBook>`;
  const book = parseFb2(fb2);
  expect(book.title).toBe('Winter Tale');
  expect(book.author).toBe('Ivan Petrov');
  expect(book.chapters.length).toBe(2);
  expect(book.chapters[0]!.title).toBe('Chapter One');
  expect(book.chapters[0]!.text).toContain('cold and quiet');
  expect(book.chapters[0]!.text).not.toContain('Chapter One'); // heading not duplicated into body
});

test('parseDocx splits on Heading1 and reads paragraph text', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const document = `<?xml version="1.0"?>
    <w:document xmlns:w="${W}"><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Part One</w:t></w:r></w:p>
      <w:p><w:r><w:t>The morning was bright and full of promise.</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Part Two</w:t></w:r></w:p>
      <w:p><w:r><w:t>By evening everything had changed completely.</w:t></w:r></w:p>
    </w:body></w:document>`;
  const zip = zipSync({ 'word/document.xml': strToU8(document) });
  const book = parseDocx(zip);
  expect(book.chapters.length).toBe(2);
  expect(book.chapters[0]!.title).toBe('Part One');
  expect(book.chapters[0]!.text).toContain('bright and full');
  expect(book.chapters[1]!.title).toBe('Part Two');
});
