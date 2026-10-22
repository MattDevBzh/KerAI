import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, RootContent } from 'mdast';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ExternalHyperlink,
} from 'docx';
import pptxgen from 'pptxgenjs';
import type { DocumentFormat } from '../shared/documentation';

type Node = {
  type: string;
  identifier?: string;
  value?: string;
  url?: string;
  alt?: string | null;
  depth?: number;
  ordered?: boolean | null;
  children?: Node[];
};
/** Resolve Markdown references before all derived formats so citations keep their targets. */
function resolveReferences(tree: Root): void {
  const definitions = new Map<string, Node>();
  const footnotes = new Map<string, Node>();
  const collect = (node: Node) => {
    if (node.identifier && node.type === 'definition')
      definitions.set(node.identifier.toLowerCase(), node);
    if (node.identifier && node.type === 'footnoteDefinition')
      footnotes.set(node.identifier.toLowerCase(), node);
    node.children?.forEach(collect);
  };
  collect(tree);
  const normalize = (node: Node): Node => {
    const definition = definitions.get(node.identifier?.toLowerCase() ?? '');
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      return {
        ...node,
        type: node.type === 'linkReference' ? 'link' : 'image',
        url: definition?.url,
        children: node.children?.map(normalize),
      };
    }
    if (node.type === 'footnoteReference') return { type: 'text', value: `[${node.identifier}]` };
    return {
      ...node,
      children: node.children
        ?.filter((c) => !['definition', 'footnoteDefinition'].includes(c.type))
        .map(normalize),
    };
  };
  const normalized = normalize(tree);
  if (footnotes.size)
    normalized.children!.push(
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Notes et sources' }] },
      ...[...footnotes.entries()].flatMap(([id, note]) => [
        { type: 'paragraph', children: [{ type: 'text', value: `[${id}]` }] },
        ...(note.children ?? []).map(normalize),
      ]),
    );
  tree.children = normalized.children as RootContent[];
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const safeUrl = (value = '') => (/^https?:\/\//i.test(value) ? value : undefined);
function text(node: Node): string {
  if (node.type === 'break') return '\n';
  if (node.type === 'list')
    return (node.children ?? [])
      .map((item, index) => `${node.ordered ? `${index + 1}.` : '•'} ${text(item)}`)
      .join('\n');
  if (node.type === 'image')
    return `[Image : ${node.alt ?? ''}]${safeUrl(node.url) ? ` (${node.url})` : ''}`;
  const content =
    node.value ??
    node.children
      ?.map(text)
      .join(
        node.type === 'tableRow'
          ? ' | '
          : node.type === 'table' || node.type === 'list'
            ? '\n'
            : '',
      ) ??
    '';
  return node.type === 'link' && safeUrl(node.url) ? `${content} (${node.url})` : content;
}
function html(node: Node): string {
  const children = () => node.children?.map(html).join('') ?? '';
  switch (node.type) {
    case 'root':
      return children();
    case 'heading':
      return `<h${node.depth}>${children()}</h${node.depth}>`;
    case 'paragraph':
      return `<p>${children()}</p>`;
    case 'strong':
      return `<strong>${children()}</strong>`;
    case 'emphasis':
      return `<em>${children()}</em>`;
    case 'delete':
      return `<del>${children()}</del>`;
    case 'list':
      return `<${node.ordered ? 'ol' : 'ul'}>${children()}</${node.ordered ? 'ol' : 'ul'}>`;
    case 'listItem':
      return `<li>${children()}</li>`;
    case 'code':
      return `<pre><code>${escape(node.value ?? '')}</code></pre>`;
    case 'inlineCode':
      return `<code>${escape(node.value ?? '')}</code>`;
    case 'blockquote':
      return `<blockquote>${children()}</blockquote>`;
    case 'link':
      return safeUrl(node.url)
        ? `<a href="${escape(node.url!)}" rel="noreferrer">${children()}</a>`
        : children();
    case 'table':
      return `<div class="table-scroll"><table>${children()}</table></div>`;
    case 'tableRow':
      return `<tr>${children()}</tr>`;
    case 'tableCell':
      return `<td>${children()}</td>`;
    case 'break':
      return '<br>';
    case 'thematicBreak':
      return '<hr>';
    default:
      return escape(text(node));
  }
}
function runs(
  node: Node,
  props: { bold?: boolean; italics?: boolean } = {},
): (TextRun | ExternalHyperlink)[] {
  if (node.type === 'break') return [new TextRun({ break: 1 })];
  if (node.type === 'link' && safeUrl(node.url))
    return [
      new ExternalHyperlink({
        link: node.url!,
        children: [new TextRun({ text: text(node), style: 'Hyperlink' })],
      }),
    ];
  if (node.children)
    return node.children.flatMap((child) =>
      runs(child, {
        ...props,
        ...(node.type === 'strong' ? { bold: true } : {}),
        ...(node.type === 'emphasis' ? { italics: true } : {}),
      }),
    );
  return [
    new TextRun({
      text: text(node),
      ...props,
      ...(node.type === 'inlineCode' ? { font: 'Consolas' } : {}),
    }),
  ];
}
function paragraphs(node: Node): (Paragraph | Table)[] {
  const spacing = { after: 160, line: 280 };
  if (node.type === 'table')
    return [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: (node.children ?? []).map(
          (row, i) =>
            new TableRow({
              tableHeader: i === 0,
              children: (row.children ?? []).map(
                (cell) =>
                  new TableCell({
                    children: [new Paragraph({ children: runs(cell, { bold: i === 0 }), spacing })],
                  }),
              ),
            }),
        ),
      }),
    ];
  if (node.type === 'list')
    return (node.children ?? []).flatMap((item, index) => [
      new Paragraph({
        children: [new TextRun(`${node.ordered ? `${index + 1}.` : '•'} `), ...runs(item)],
        spacing,
        indent: { left: 360 },
      }),
    ]);
  if (node.type === 'code')
    return (node.value ?? '').split('\n').map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18 })],
          spacing: { after: 0 },
          shading: { fill: 'F2F4F8' },
        }),
    );
  if (node.type === 'heading')
    return [
      new Paragraph({
        children: runs(node),
        heading: [
          HeadingLevel.HEADING_1,
          HeadingLevel.HEADING_2,
          HeadingLevel.HEADING_3,
          HeadingLevel.HEADING_4,
          HeadingLevel.HEADING_5,
          HeadingLevel.HEADING_6,
        ][(node.depth ?? 1) - 1],
        spacing: { before: 260, after: 160 },
      }),
    ];
  if (node.type === 'thematicBreak') return [new Paragraph({ text: '—', spacing })];
  return [new Paragraph({ children: runs(node), spacing })];
}
/** Bounded slides with source text retained across continuation slides. */
export function presentationPages(nodes: RootContent[]): { title: string; lines: string[] }[] {
  const pages: { title: string; lines: string[] }[] = [];
  let title = 'Documentation technique',
    lines: string[] = [];
  const flush = () => {
    if (lines.length) {
      if (pages.length >= 200)
        throw Error('La présentation dépasse 200 diapositives. Prépare une synthèse plus courte.');
      pages.push({ title, lines });
    }
    lines = [];
  };
  for (const node of nodes) {
    if (node.type === 'heading') {
      flush();
      title = text(node);
      continue;
    }
    const value = text(node);
    // Prefer word boundaries; the code-point ceiling also handles very long URLs.
    const wrapped = value.split('\n').flatMap((line) => {
      const chars = Array.from(line);
      const result: string[] = [];
      for (let offset = 0; offset < chars.length; ) {
        const candidate = chars.slice(offset, offset + 72).join('');
        const lastSpace = candidate.lastIndexOf(' ');
        const length =
          chars.length - offset > 72 && lastSpace > 30
            ? Array.from(candidate.slice(0, lastSpace + 1)).length
            : 72;
        result.push(chars.slice(offset, offset + length).join(''));
        offset += length;
      }
      return result.length ? result : [''];
    });
    for (const line of wrapped) {
      if (lines.length >= 11) flush();
      lines.push(line);
    }
    if (lines.length < 11) lines.push('');
  }
  flush();
  return pages.length ? pages : [{ title, lines: [] }];
}
export async function exportDocument(
  content: string,
  format: DocumentFormat,
  title: string,
): Promise<Buffer> {
  if (Buffer.byteLength(content) > 2_000_000)
    throw Error('Le document dépasse la limite d’export de 2 Mo de texte.');
  if (format === 'md') return Buffer.from(content, 'utf8');
  const tree = unified().use(remarkParse).use(remarkGfm).parse(content) as Root;
  resolveReferences(tree);
  if (format === 'html')
    return Buffer.from(
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(title)}</title><style>body{font:17px/1.65 system-ui,sans-serif;color:#172b46;background:#fafbfd;margin:0}main{max-width:900px;margin:auto;padding:48px 24px}h1,h2,h3{line-height:1.25;color:#142e52}h1{border-bottom:5px solid #edb84b;padding-bottom:20px}h2{margin-top:2em}a{color:#005caf;overflow-wrap:anywhere}pre{background:#eaf0f6;padding:18px;overflow:auto}code{font-size:.88em}table{border-collapse:collapse;width:100%}td{border:1px solid #cbd5e1;padding:9px;vertical-align:top}tr:first-child{font-weight:bold;background:#eaf0f6}.table-scroll{overflow:auto}blockquote{border-left:4px solid #edb84b;margin-left:0;padding-left:20px}@media print{body{background:white}main{padding:0}a{color:inherit}pre{white-space:pre-wrap}h1,h2,h3{break-after:avoid}}</style></head><body><main>${html(tree)}</main></body></html>`,
    );
  if (format === 'docx')
    return Packer.toBuffer(
      new Document({
        title,
        creator: 'KerAI · Feature Studio',
        styles: { default: { document: { run: { font: 'Aptos', size: 22, color: '172B46' } } } },
        sections: [{ properties: {}, children: tree.children.flatMap(paragraphs) }],
      }),
    );
  if (format !== 'pptx') throw Error('Format de documentation inconnu.');
  const pages = presentationPages(tree.children);
  if (pages.length > 200)
    throw Error('La présentation dépasse 200 diapositives. Prépare une synthèse plus courte.');
  const deck = new pptxgen();
  deck.layout = 'LAYOUT_WIDE';
  deck.author = 'KerAI · Feature Studio';
  deck.subject = 'Documentation technique';
  deck.title = title;
  deck.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos' };
  pages.forEach((page, index) => {
    const slide = deck.addSlide();
    slide.background = { color: 'FAFBFD' };
    slide.addShape(deck.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 0.16,
      h: 7.5,
      fill: { color: 'EDB84B' },
      line: { transparency: 100 },
    });
    slide.addText(page.title, {
      x: 0.65,
      y: 0.35,
      w: 12,
      h: 0.9,
      fontSize: 28,
      bold: true,
      color: '142E52',
      margin: 0,
      breakLine: false,
      fit: 'shrink',
    });
    slide.addText(page.lines.join('\n'), {
      x: 0.65,
      y: 1.55,
      w: 12,
      h: 4.95,
      fontSize: 22,
      color: '172B46',
      margin: 0,
      valign: 'top',
      breakLine: false,
      fit: 'shrink',
      paraSpaceAfter: 7,
    });
    slide.addText(`${title.slice(0, 100)}  ·  ${index + 1} / ${pages.length}`, {
      x: 0.65,
      y: 6.95,
      w: 12,
      h: 0.22,
      fontSize: 10,
      color: '627185',
      margin: 0,
    });
    slide.addNotes(page.lines.join('\n'));
  });
  return Buffer.from((await deck.write({ outputType: 'nodebuffer', compression: true })) as Buffer);
}
