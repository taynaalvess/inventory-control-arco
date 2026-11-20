/**
 * Leitura do PDF do DANFE (representação impressa da NF-e), 100% no navegador.
 *
 * Estratégia:
 *  1. extrai o texto com posição (pdf.js) e remonta as linhas;
 *  2. chave de acesso (44 dígitos com DV) → CNPJ do emitente, série e número exatos;
 *  3. itens: cada linha da tabela segue CÓDIGO · DESCRIÇÃO · NCM · CST · CFOP · UN · QTD · V.UNIT · V.TOTAL;
 *  4. totais: valor logo abaixo de cada rótulo ("VALOR DO FRETE", "VALOR TOTAL DA NOTA"…);
 *  5. frete/seguro/outras/desconto/IPI/ST são rateados pelos itens proporcionalmente ao valor;
 *  6. confere soma dos itens × totais e gera avisos.
 * O resultado sempre passa pela tela de revisão antes de lançar.
 */
import type { Nfe, NfeItem } from './nfe';

export interface TextItem {
  s: string;
  x: number;
  y: number;
  w: number;
  h: number;
  page: number;
}

interface Line {
  page: number;
  y: number;
  h: number;
  text: string;
  /** índice do caractere → item de origem */
  map: number[];
  items: TextItem[];
}

/* ------------------------------ extração ------------------------------ */

export async function readPdfText(file: File): Promise<TextItem[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
  const out: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      out.push({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height || 6, page: p });
    }
  }
  await doc.destroy();
  return out;
}

export async function parseDanfePdf(file: File): Promise<Nfe> {
  const items = await readPdfText(file);
  if (items.length < 20)
    throw new Error('Não encontrei texto neste PDF — parece ser uma imagem escaneada. Peça o XML ou o PDF gerado pelo sistema do fornecedor.');
  return parseDanfeText(items);
}

/* ------------------------------ linhas ------------------------------ */

function toLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const groups: TextItem[][] = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    const ref = g?.[0];
    if (g && ref.page === it.page && Math.abs(ref.y - it.y) <= Math.max(1.5, Math.min(ref.h, it.h) * 0.45)) g.push(it);
    else groups.push([it]);
  }
  return groups.map((g) => {
    g.sort((a, b) => a.x - b.x);
    let text = '';
    const map: number[] = [];
    g.forEach((it, i) => {
      if (i > 0) {
        const prev = g[i - 1];
        const gap = it.x - (prev.x + prev.w);
        if (gap > Math.max(0.8, it.h * 0.18)) {
          text += ' ';
          map.push(i);
        }
      }
      for (let c = 0; c < it.s.length; c++) map.push(i);
      text += it.s;
    });
    return { page: g[0].page, y: g[0].y, h: Math.max(...g.map((x) => x.h)), text: text.replace(/\s+$/, ''), map, items: g };
  });
}

/* ------------------------------ helpers ------------------------------ */

const N = String.raw`\d[\d.]*(?:,\d+)?`;
export const brNum = (s: string | undefined) => {
  if (!s) return 0;
  const v = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};

/** DV módulo 11 da chave de acesso */
export function validKey(k: string) {
  if (!/^\d{44}$/.test(k)) return false;
  let sum = 0;
  let w = 2;
  for (let i = 42; i >= 0; i--) {
    sum += Number(k[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = sum % 11;
  const dv = r < 2 ? 0 : 11 - r;
  return dv === Number(k[43]);
}

function findKey(lines: Line[]) {
  const all = lines.map((l) => l.text).join('\n');
  const re = /(?:\d{4}[\s.]*){10}\d{4}/g;
  for (const m of all.matchAll(re)) {
    const k = m[0].replace(/\D/g, '');
    if (validKey(k)) return k;
  }
  // às vezes vem tudo grudado
  for (const m of all.replace(/[\s.]/g, '').matchAll(/\d{44}/g)) if (validKey(m[0])) return m[0];
  return '';
}

/** Valor que aparece logo abaixo do rótulo (layout de caixas do DANFE). */
function valueBelow(lines: Line[], label: RegExp, value: RegExp, until = lines.length): string {
  for (let i = 0; i < until; i++) {
    const l = lines[i];
    const m = label.exec(l.text);
    if (!m) continue;
    const a = l.items[l.map[m.index] ?? 0];
    const b = l.items[l.map[m.index + m[0].length - 1] ?? l.items.length - 1];
    const x0 = a.x - 12;
    const x1 = b.x + b.w + 12;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const nl = lines[j];
      if (nl.page !== l.page || l.y - nl.y > l.h * 4 + 6) break;
      const seg = nl.items
        .filter((it) => it.x + it.w >= x0 && it.x <= x1)
        .map((it) => it.s)
        .join(' ');
      const v = value.exec(seg);
      if (v) return v[1] ?? v[0];
    }
    // valor na mesma linha, logo após o rótulo
    const rest = l.text.slice(m.index + m[0].length);
    const v = value.exec(rest);
    if (v && rest.trim().indexOf(v[0]) < 3) return v[1] ?? v[0];
  }
  return '';
}

const MONEY = new RegExp(`(${N})`);
const DATE = /(\d{2}\/\d{2}\/\d{4})/;

/* ------------------------------ itens ------------------------------ */

const ROW = new RegExp(
  String.raw`^\s*(\S{1,60}?)\s+(.+?)\s+(\d{8}|\d{4}\.\d{2}\.\d{2})\s+(\d{2,4})\s+([1-7]\d{3})\s+([A-Za-zÇç]{1,6}\.?)\s+(${N})\s+(${N})\s+(${N})((?:\s+${N}%?)*)`,
  'd',
);

const STOP = /DADOS\s+ADICIONAIS|C[ÁA]LCULO\s+DO\s+ISSQN|INFORMA[ÇC][ÕO]ES\s+COMPLEMENTARES|RESERVADO\s+AO\s+FISCO/i;
const HEADER = /DESCRI[ÇC][ÃA]O|NCM|CFOP|C[ÓO]DIGO|PRODUTO|QUANT|UNIT|VALOR/i;

interface RawItem {
  code: string;
  name: string;
  ncm: string;
  cfop: string;
  unit: string;
  qty: number;
  unitPrice: number;
  total: number;
  descX: number;
  page: number;
  y: number;
}

function parseItems(lines: Line[], warnings: string[]) {
  const out: RawItem[] = [];
  let last: RawItem | null = null;
  let stopped = false;
  for (const l of lines) {
    if (STOP.test(l.text)) {
      stopped = true;
      last = null;
      continue;
    }
    const m = ROW.exec(l.text) as (RegExpExecArray & { indices?: [number, number][] }) | null;
    if (m) {
      stopped = false;
      const qty = brNum(m[7]);
      const unitPrice = brNum(m[8]);
      // a coluna após V.UNIT pode ser "desconto" em alguns layouts: escolhe a que bate com qtd × unit
      const nums = [m[9], ...(m[10] ?? '').trim().split(/\s+/).filter(Boolean)].map((x) => brNum(x.replace('%', '')));
      const expected = qty * unitPrice;
      const total = nums.find((v) => Math.abs(v - expected) <= Math.max(0.05, expected * 0.01)) ?? nums[0];
      const descStart = m.indices?.[2]?.[0] ?? 0;
      const di = l.items[l.map[descStart] ?? 0];
      last = {
        code: m[1],
        name: m[2].trim(),
        ncm: m[3].replace(/\D/g, ''),
        cfop: m[5],
        unit: m[6].replace('.', '').toUpperCase(),
        qty,
        unitPrice,
        total,
        descX: di?.x ?? 0,
        page: l.page,
        y: l.y,
      };
      if (Math.abs(total - expected) > Math.max(0.05, expected * 0.01)) warnings.push(`Item ${m[1]}: quantidade × valor unitário (${expected.toFixed(2)}) difere do total lido (${total.toFixed(2)}).`);
      out.push(last);
      continue;
    }
    // continuação da descrição (quebra de linha dentro da célula)
    if (last && !stopped && l.page === last.page && last.y - l.y < l.h * 3.2 && !HEADER.test(l.text)) {
      const first = l.items[0];
      if (first && Math.abs(first.x - last.descX) < 40 && /[A-Za-zÀ-ú]/.test(l.text) && !new RegExp(`^${N}$`).test(l.text.trim())) {
        last.name = `${last.name} ${l.text.trim()}`.slice(0, 250);
        last.y = l.y;
        continue;
      }
    }
    if (last && l.page === last.page && last.y - l.y > l.h * 3.2) last = null;
  }
  return out;
}

/* ------------------------------ principal ------------------------------ */

export function parseDanfeText(textItems: TextItem[]): Nfe {
  const lines = toLines(textItems);
  const warnings: string[] = [];
  const flat = lines.map((l) => l.text).join(' ');

  const key = findKey(lines);
  if (!key) warnings.push('Não encontrei a chave de acesso: confira número e fornecedor, e a checagem de nota duplicada fica desativada.');

  const cnpjFromText = flat.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)?.[0].replace(/\D/g, '') ?? '';
  const document = key ? key.slice(6, 20) : cnpjFromText;
  const series = key ? String(Number(key.slice(22, 25))) : flat.match(/S[ÉE]RIE\s*:?\s*(\d{1,3})/i)?.[1] ?? '';
  const number = key ? String(Number(key.slice(25, 34))) : (flat.match(/N[º°o]\.?\s*:?\s*([\d.]{1,11})/)?.[1] ?? '').replace(/\D/g, '');
  const name = flat.match(/RECEBEMOS\s+DE\s+(.+?)\s+OS\s+PRODUTOS/i)?.[1]?.trim() ?? '';

  const tableIdx = lines.findIndex((l) => /DESCRI[ÇC][ÃA]O/i.test(l.text) && /NCM|CFOP|UNIT|QUANT/i.test(l.text));
  const before = tableIdx > 0 ? tableIdx : lines.length;

  const dateStr = valueBelow(lines, /DATA\s+(?:DA|DE)\s+EMISS[ÃA]O/i, DATE) || flat.match(DATE)?.[1] || '';
  const [d, mo, y] = dateStr.split('/');
  const issuedAt = y ? `${y}-${mo}-${d}` : '';

  const money = (re: RegExp) => brNum(valueBelow(lines, re, MONEY, before));
  const totals = {
    products: money(/VALOR\s+TOTAL\s+DOS\s+PRODUTOS|V\.\s*TOTAL\s+PRODUTOS/i),
    freight: money(/VALOR\s+DO\s+FRETE|V\.\s*FRETE/i),
    discount: money(/DESCONTO/i),
    ipi: money(/VALOR\s+(?:TOTAL\s+)?(?:DO\s+)?IPI|V\.\s*(?:TOTAL\s+)?IPI/i),
    st: money(/VALOR\s+DO\s+ICMS\s+(?:SUBST|ST)|V\.\s*ICMS\s+(?:SUBST|ST)|ICMS\s+SUBSTITUI[ÇC][ÃA]O/i),
    invoice: money(/VALOR\s+TOTAL\s+DA\s+NOTA|V\.\s*TOTAL\s+(?:DA\s+)?NOTA/i),
  };
  const insurance = money(/VALOR\s+DO\s+SEGURO|V\.\s*SEGURO/i);
  const other = money(/OUTRAS\s+DESPESAS/i);

  const raw = parseItems(lines, warnings);
  if (!raw.length) throw new Error('Não consegui identificar os itens neste DANFE. Envie o XML da nota (o fornecedor tem e é obrigado a fornecer).');

  const sum = raw.reduce((s, r) => s + r.total, 0);
  if (totals.products && Math.abs(sum - totals.products) > 0.05)
    warnings.push(`A soma dos itens lidos (R$ ${sum.toFixed(2)}) difere do total dos produtos (R$ ${totals.products.toFixed(2)}). Algum item pode não ter sido reconhecido.`);
  if (!totals.products) totals.products = sum;

  const share = (r: RawItem) => (sum ? r.total / sum : 0);
  const items: NfeItem[] = raw.map((r, i) => ({
    nItem: i + 1,
    code: r.code,
    ean: '',
    eanTrib: '',
    name: r.name,
    ncm: r.ncm,
    cfop: r.cfop,
    unit: r.unit,
    qty: r.qty,
    unitTrib: r.unit,
    qtyTrib: r.qty,
    unitPrice: r.unitPrice,
    total: r.total,
    freight: totals.freight * share(r),
    insurance: insurance * share(r),
    discount: totals.discount * share(r),
    other: other * share(r),
    ipi: totals.ipi * share(r),
    st: totals.st * share(r),
  }));

  const landed = totals.products + totals.freight + insurance + other - totals.discount + totals.ipi + totals.st;
  if (totals.invoice && Math.abs(landed - totals.invoice) > 1)
    warnings.push(`Produtos + frete + impostos − desconto (R$ ${landed.toFixed(2)}) não fecha com o valor da nota (R$ ${totals.invoice.toFixed(2)}). Confira os custos.`);

  return {
    key,
    number,
    series,
    issuedAt,
    supplier: { document, name, tradeName: '', phone: '', email: '' },
    items,
    totals,
    source: 'pdf',
    warnings,
  };
}
