import JsBarcode from 'jsbarcode';
import { brl } from './format';
import type { Product } from './types';

function barcodeSvg(value: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const opts = { width: 1.6, height: 48, fontSize: 12, margin: 0, displayValue: true };
  let ok = false;
  if (/^\d{13}$/.test(value)) {
    JsBarcode(svg, value, { ...opts, format: 'EAN13', valid: (v: boolean) => (ok = v) });
  }
  if (!ok) JsBarcode(svg, value, { ...opts, format: 'CODE128' });
  return svg.outerHTML;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Abre uma janela de impressão com etiquetas (código de barras = EAN, ou SKU quando não houver EAN). */
export function printLabels(items: { product: Product; copies: number }[], showPrice = true) {
  const labels: string[] = [];
  for (const { product: p, copies } of items) {
    const code = p.ean || p.sku;
    const svg = barcodeSvg(code);
    for (let i = 0; i < copies; i++) {
      labels.push(`<div class="l"><div class="n">${esc(p.name)}</div>${svg}<div class="f"><span>${esc(p.sku)}</span>${
        showPrice && p.price ? `<b>${brl(p.price)}</b>` : ''
      }</div></div>`);
    }
  }
  const w = window.open('', '_blank');
  if (!w) {
    alert('Permita pop-ups para imprimir as etiquetas.');
    return;
  }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>
    @page { margin: 6mm; }
    body { font-family: system-ui, sans-serif; margin: 0; }
    .g { display: grid; grid-template-columns: repeat(auto-fill, 60mm); gap: 3mm; }
    .l { width: 60mm; height: 32mm; box-sizing: border-box; border: 1px dashed #ccc; padding: 2mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between; break-inside: avoid; overflow: hidden; }
    .l svg { max-width: 100%; height: auto; }
    .n { font-size: 9pt; font-weight: 600; text-align: center; line-height: 1.1; max-height: 2.2em; overflow: hidden; }
    .f { width: 100%; display: flex; justify-content: space-between; font-size: 8pt; }
    @media print { .l { border-color: transparent; } .hint { display: none; } }
    .hint { padding: 8px; font-size: 12px; color: #555; }
  </style></head><body><div class="hint">Dica: ajuste o tamanho da etiqueta para sua impressora (ex.: 60×32mm). Ctrl+P para imprimir.</div><div class="g">${labels.join('')}</div></body></html>`);
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
  }, 400);
}
