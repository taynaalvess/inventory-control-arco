import * as XLSX from 'xlsx';
import { norm } from './format';

export interface Sheet {
  headers: string[];
  rows: Record<string, unknown>[];
  sheetName: string;
}

/** Lê a primeira aba de um .xlsx/.xls/.csv. A linha de cabeçalho é a primeira com 2+ colunas preenchidas. */
export async function readSheet(file: File): Promise<Sheet> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true, blankrows: false });
  const headerIdx = matrix.findIndex((r) => r.filter((c) => String(c).trim() !== '').length >= 2);
  if (headerIdx < 0) throw new Error('Não encontrei cabeçalho na planilha.');
  const seen = new Map<string, number>();
  const headers = matrix[headerIdx].map((h, i) => {
    let name = String(h).trim() || `Coluna ${i + 1}`;
    const c = seen.get(name) ?? 0;
    seen.set(name, c + 1);
    if (c) name = `${name} (${c + 1})`;
    return name;
  });
  const rows = matrix
    .slice(headerIdx + 1)
    .filter((r) => r.some((c) => String(c).trim() !== ''))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  return { headers, rows, sheetName };
}

export interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  synonyms: string[];
}

export const PRODUCT_FIELDS: FieldDef[] = [
  { key: 'sku', label: 'SKU', required: true, synonyms: ['sku', 'sku do produto', 'sku da variante', 'sku variante', 'codigo sku', 'codigo do produto', 'codigo', 'cod', 'referencia', 'sku principal'] },
  { key: 'name', label: 'Nome', required: true, synonyms: ['nome', 'nome do produto', 'produto', 'titulo', 'titulo do produto', 'descricao', 'nome do sku', 'nome da variante'] },
  { key: 'ean', label: 'Código de barras (EAN/GTIN)', synonyms: ['ean', 'gtin', 'codigo de barras', 'ean/gtin', 'gtin/ean', 'cod barras', 'barcode', 'upc'] },
  { key: 'stock', label: 'Estoque', synonyms: ['estoque', 'estoque disponivel', 'quantidade disponivel', 'disponivel', 'qtd', 'quantidade', 'estoque atual', 'saldo', 'estoque total', 'estoque fisico'] },
  { key: 'price', label: 'Preço de venda', synonyms: ['preco', 'preco de venda', 'preco venda', 'valor de venda', 'preco unitario'] },
  { key: 'cost', label: 'Custo', synonyms: ['custo', 'preco de custo', 'custo unitario', 'custo medio', 'preco de compra'] },
  { key: 'category', label: 'Categoria', synonyms: ['categoria', 'categoria do produto', 'grupo', 'departamento'] },
  { key: 'brand', label: 'Marca', synonyms: ['marca', 'fabricante'] },
  { key: 'location', label: 'Localização', synonyms: ['localizacao', 'local', 'endereco', 'posicao', 'prateleira', 'local de armazenamento'] },
  { key: 'minStock', label: 'Estoque mínimo', synonyms: ['estoque minimo', 'minimo', 'estoque de seguranca', 'alerta de estoque'] },
];

export const ORDER_FIELDS: FieldDef[] = [
  { key: 'orderId', label: 'Nº do pedido', required: true, synonyms: ['numero do pedido', 'n do pedido', 'no do pedido', 'nº do pedido', 'id do pedido', 'pedido', 'order id', 'codigo do pedido', 'numero pedido'] },
  { key: 'sku', label: 'SKU', required: true, synonyms: ['sku', 'sku do produto', 'sku da variante', 'sku variante', 'codigo sku', 'sku do anuncio', 'sku (variante)'] },
  { key: 'qty', label: 'Quantidade', required: true, synonyms: ['quantidade', 'qtd', 'qtde', 'quantidade do produto', 'quantidade vendida', 'unidades'] },
  { key: 'unitPrice', label: 'Preço unitário', synonyms: ['preco unitario', 'preco', 'valor unitario', 'preco do produto', 'preco de venda'] },
  { key: 'total', label: 'Total do item', synonyms: ['total', 'valor total', 'subtotal', 'total do produto', 'valor do produto', 'total do pedido'] },
  { key: 'store', label: 'Loja', synonyms: ['loja', 'nome da loja', 'loja online', 'canal', 'marketplace', 'plataforma', 'conta'] },
  { key: 'date', label: 'Data', synonyms: ['data', 'data do pedido', 'hora do pedido', 'data de criacao', 'criado em', 'data de pagamento', 'data da venda'] },
  { key: 'status', label: 'Status', synonyms: ['status', 'status do pedido', 'situacao', 'estado do pedido'] },
];

export type Mapping = Record<string, string>;

export function guessMapping(headers: string[], fields: FieldDef[]): Mapping {
  const map: Mapping = {};
  const used = new Set<string>();
  const normalized = headers.map((h) => ({ h, n: norm(h).replace(/[()]/g, '') }));
  // 1ª passada: correspondência exata; 2ª: o cabeçalho contém o sinônimo
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of fields) {
      if (map[f.key]) continue;
      for (const syn of f.synonyms) {
        const hit = normalized.find(({ h, n }) => !used.has(h) && (pass === 'exact' ? n === syn : n.includes(syn)));
        if (hit) {
          map[f.key] = hit.h;
          used.add(hit.h);
          break;
        }
      }
    }
  }
  return map;
}

export const cell = (row: Record<string, unknown>, mapping: Mapping, key: string) =>
  mapping[key] ? row[mapping[key]] : undefined;

export function str(v: unknown) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim();
}

/** Aceita 1.234,56 | 1234.56 | R$ 12,90 | 12 */
export function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = str(v).replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Aceita Date, dd/mm/aaaa [hh:mm[:ss]], ISO e número serial do Excel. */
export function parseDate(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(d.y, d.m - 1, d.d, d.H, d.M, Math.floor(d.S));
  }
  const s = str(v);
  if (!s) return null;
  const br = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) {
    const y = br[3].length === 2 ? 2000 + Number(br[3]) : Number(br[3]);
    return new Date(y, Number(br[2]) - 1, Number(br[1]), Number(br[4] ?? 12), Number(br[5] ?? 0), Number(br[6] ?? 0));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export const CANCELLED = /cancel|devolv|reembols|estorn|nao pago|não pago|unpaid|refund/i;

export function guessChannel(storeName: string) {
  const n = norm(storeName);
  if (n.includes('shopee')) return 'Shopee';
  if (n.includes('mercado') || n.includes('meli') || /\bml\b/.test(n)) return 'Mercado Livre';
  if (n.includes('amazon')) return 'Amazon';
  if (n.includes('magalu') || n.includes('magazine')) return 'Magalu';
  if (n.includes('shein')) return 'Shein';
  if (n.includes('tiktok')) return 'TikTok Shop';
  if (n.includes('americanas')) return 'Americanas';
  if (n.includes('fisica') || n.includes('balcao')) return 'Loja física';
  return 'Outro';
}
