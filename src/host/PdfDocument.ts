import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export interface PdfBlock {
  text: string;
  heading?: number;
  code?: boolean;
}
/** Local, deterministic export: embedded fonts, bounded pages, no browser or network. */
export async function exportPdf(
  blocks: PdfBlock[],
  title: string,
  resourcesPath: string,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(title);
  doc.setAuthor('KerAI · Feature Studio');
  const [regular, bold] = await Promise.all(
    ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'].map(async (name) =>
      doc.embedFont(await readFile(join(resourcesPath, 'fonts', name)), { subset: true }),
    ),
  );
  const available = new Set(regular.getCharacterSet());
  const replacements = new Set<string>();
  const printable = (text: string) =>
    Array.from(text)
      .map((char) => {
        if (char === '\n' || char === '\t') return char === '\t' ? '    ' : char;
        const point = char.codePointAt(0)!;
        if (point < 32 || point === 127) return '';
        if (available.has(point)) return char;
        const code = `U+${point.toString(16).toUpperCase()}`;
        replacements.add(code);
        return `[${code}]`;
      })
      .join('');
  const width = 595.28,
    height = 841.89,
    margin = 48,
    contentWidth = width - margin * 2;
  let page: PDFPage, y: number;
  const newPage = () => {
    if (doc.getPageCount() >= 500)
      throw new Error('Le PDF dépasse 500 pages. Exporte un document plus court.');
    page = doc.addPage([width, height]);
    y = height - margin;
  };
  newPage();
  const wrap = (text: string, font: PDFFont, size: number) => {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const part of paragraph.split(/(\s+)/)) {
        if (font.widthOfTextAtSize(line + part, size) <= contentWidth) {
          line += part;
          continue;
        }
        if (line.trim()) lines.push(line.trimEnd());
        line = '';
        for (const char of Array.from(part)) {
          if (font.widthOfTextAtSize(line + char, size) > contentWidth) {
            lines.push(line);
            line = '';
          }
          line += char;
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  };
  const draw = (block: PdfBlock) => {
    const font = block.heading ? bold : regular;
    const size = block.heading ? Math.max(12, 23 - block.heading * 2) : block.code ? 9 : 10.5;
    const leading = size * 1.5;
    const lines = wrap(printable(block.text), font, size);
    if (block.heading && y - Math.min(lines.length + 2, 7) * leading < margin + 16) newPage();
    if (block.heading) y -= 10;
    for (const line of lines) {
      if (y - leading < margin + 16) newPage();
      page.drawText(line, {
        x: margin,
        y: y - size,
        font,
        size,
        color: block.heading ? rgb(0.08, 0.18, 0.32) : rgb(0.09, 0.12, 0.16),
      });
      y -= leading;
    }
    y -= block.heading ? 6 : 8;
  };
  for (const block of blocks) draw(block);
  if (replacements.size)
    draw({
      text: `Note d’export : les symboles non couverts par la police sont conservés sous leur code Unicode entre crochets (${[...replacements].join(', ')}).`,
      heading: undefined,
    });
  doc.getPages().forEach((page, index) => {
    page.drawLine({
      start: { x: margin, y: 38 },
      end: { x: width - margin, y: 38 },
      thickness: 0.5,
      color: rgb(0.7, 0.75, 0.8),
    });
    page.drawText(`${index + 1} / ${doc.getPageCount()}`, {
      x: width - margin - 45,
      y: 24,
      font: regular,
      size: 8,
      color: rgb(0.4, 0.45, 0.5),
    });
  });
  return Buffer.from(await doc.save());
}
