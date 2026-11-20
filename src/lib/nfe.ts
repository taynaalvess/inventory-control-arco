/**
 * Leitor de NF-e (XML oficial da SEFAZ, layout 4.00).
 * Extrai emitente, identificação e itens com o custo real de entrada:
 *   vProd + frete + seguro + outras despesas − desconto (+ IPI + ICMS-ST, opcional).
 */

export interface NfeItem {
  nItem: number;
  code: string; // cProd (código do fornecedor)
  ean: string; // cEAN (unidade comercial)
  eanTrib: string; // cEANTrib (unidade tributável)
  name: string;
  ncm: string;
  cfop: string;
  unit: string; // uCom
  qty: number; // qCom
  unitTrib: string;
  qtyTrib: number;
  unitPrice: number; // vUnCom
  total: number; // vProd
  freight: number;
  insurance: number;
  discount: number;
  other: number;
  ipi: number;
  st: number;
}

export interface Nfe {
  key: string;
  number: string;
  series: string;
  issuedAt: string;
  supplier: { document: string; name: string; tradeName: string; phone: string; email: string };
  items: NfeItem[];
  totals: { products: number; freight: number; discount: number; ipi: number; st: number; invoice: number };
  /** xml = leitura exata; pdf = leitura do DANFE (conferir) */
  source?: 'xml' | 'pdf';
  warnings?: string[];
}

/** Semelhança entre nomes de produto (0–1), por palavras em comum (Dice). */
export function nameSimilarity(a: string, b: string) {
  const tok = (s: string) =>
    new Set(
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .filter((t) => t.length > 1),
    );
  const A = tok(a);
  const B = tok(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

const num = (v: string | null | undefined) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};

function first(root: Element | Document, ...names: string[]): Element | null {
  for (const n of names) {
    const el = root.getElementsByTagNameNS('*', n)[0];
    if (el) return el;
  }
  return null;
}

const txt = (root: Element | Document | null, ...path: string[]) => {
  if (!root) return '';
  let cur: Element | Document | null = root;
  for (const p of path) {
    cur = cur ? first(cur, p) : null;
    if (!cur) return '';
  }
  return (cur as Element).textContent?.trim() ?? '';
};

/** Soma um campo dentro de qualquer grupo de imposto (ex.: ICMS00, ICMS10… → vICMSST). */
const sumTag = (root: Element | null, tag: string) =>
  root ? Array.from(root.getElementsByTagNameNS('*', tag)).reduce((s, el) => s + num(el.textContent), 0) : 0;

const cleanEan = (v: string) => (/^\d{8,14}$/.test(v) ? v : '');

export function parseNfe(xml: string): Nfe {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Arquivo XML inválido.');
  const inf = first(doc, 'infNFe');
  if (!inf) throw new Error('Este XML não é uma NF-e (não encontrei <infNFe>). Envie o XML da nota, não o PDF/DANFE.');

  const key = (txt(doc, 'protNFe', 'chNFe') || (inf.getAttribute('Id') ?? '').replace(/^NFe/, '')).replace(/\D/g, '');
  const ide = first(inf, 'ide');
  const emit = first(inf, 'emit');
  const tot = first(inf, 'ICMSTot');

  const items: NfeItem[] = Array.from(inf.getElementsByTagNameNS('*', 'det')).map((det, i) => {
    const prod = first(det, 'prod');
    const imposto = first(det, 'imposto');
    const ipiGroup = imposto ? first(imposto, 'IPI') : null;
    const icmsGroup = imposto ? first(imposto, 'ICMS') : null;
    return {
      nItem: Number(det.getAttribute('nItem')) || i + 1,
      code: txt(prod, 'cProd'),
      ean: cleanEan(txt(prod, 'cEAN')),
      eanTrib: cleanEan(txt(prod, 'cEANTrib')),
      name: txt(prod, 'xProd'),
      ncm: txt(prod, 'NCM'),
      cfop: txt(prod, 'CFOP'),
      unit: txt(prod, 'uCom'),
      qty: num(txt(prod, 'qCom')),
      unitTrib: txt(prod, 'uTrib'),
      qtyTrib: num(txt(prod, 'qTrib')),
      unitPrice: num(txt(prod, 'vUnCom')),
      total: num(txt(prod, 'vProd')),
      freight: num(txt(prod, 'vFrete')),
      insurance: num(txt(prod, 'vSeg')),
      discount: num(txt(prod, 'vDesc')),
      other: num(txt(prod, 'vOutro')),
      ipi: sumTag(ipiGroup, 'vIPI'),
      st: sumTag(icmsGroup, 'vICMSST') + sumTag(icmsGroup, 'vFCPST'),
    };
  });

  if (!items.length) throw new Error('A nota não tem itens.');

  return {
    key,
    number: txt(ide, 'nNF'),
    series: txt(ide, 'serie'),
    issuedAt: txt(ide, 'dhEmi') || txt(ide, 'dEmi'),
    supplier: {
      document: txt(emit, 'CNPJ') || txt(emit, 'CPF'),
      name: txt(emit, 'xNome'),
      tradeName: txt(emit, 'xFant'),
      phone: txt(emit, 'enderEmit', 'fone'),
      email: txt(emit, 'email'),
    },
    items,
    source: 'xml',
    warnings: [],
    totals: {
      products: num(txt(tot, 'vProd')),
      freight: num(txt(tot, 'vFrete')),
      discount: num(txt(tot, 'vDesc')),
      ipi: num(txt(tot, 'vIPI')),
      st: num(txt(tot, 'vST')),
      invoice: num(txt(tot, 'vNF')),
    },
  };
}

/** Custo total de entrada do item (o que efetivamente custou para colocar no estoque). */
export function itemLandedTotal(it: NfeItem, includeTaxes: boolean) {
  const base = it.total + it.freight + it.insurance + it.other - it.discount;
  return Math.max(0, base + (includeTaxes ? it.ipi + it.st : 0));
}

/**
 * Sugere fator de conversão (ex.: 1 CX = 12 UN) quando a nota traz unidade comercial
 * diferente da tributável com quantidades proporcionais.
 */
export function suggestFactor(it: NfeItem) {
  // 1) a própria nota informa: 2 CX (comercial) = 24 UN (tributável)
  if (it.qty && it.qtyTrib && it.unit.toUpperCase() !== it.unitTrib.toUpperCase()) {
    const f = it.qtyTrib / it.qty;
    if (Number.isInteger(f) && f > 1) return f;
  }
  // 2) embalagem descrita no nome: "CX C/12", "PCT COM 6", "FD 24UN", "DZ"
  const unit = it.unit.toUpperCase();
  if (unit === 'DZ' || unit === 'DUZIA') return 12;
  if (/^(CX|CXA|CAIXA|PCT|PC|PT|PACOTE|FD|FARDO|DP|DISPLAY|KIT|CJ|CONJ|EMB|BL|BLISTER)$/.test(unit)) {
    const m = it.name.toUpperCase().match(/(?:C\/|COM\s+|CX\s*|X\s*)(\d{1,4})\s*(?:UN|UND|UNID|UNIDADES|PCS?|PE[CÇ]AS)?\b|(\d{1,4})\s*(?:UN|UND|UNID|UNIDADES|PCS|PE[CÇ]AS)\b/);
    const f = Number(m?.[1] ?? m?.[2]);
    if (Number.isInteger(f) && f > 1 && f <= 1000) return f;
  }
  return 1;
}

export const onlyDigits = (s: string) => s.replace(/\D/g, '');

export function formatDoc(d: string) {
  const x = onlyDigits(d);
  if (x.length === 14) return x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (x.length === 11) return x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return d;
}

/** Só aceita links http(s) — bloqueia "javascript:" e afins. */
export function safeUrl(raw: string) {
  const v = raw.trim();
  if (!v) return '';
  const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withProto);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}
