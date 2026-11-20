/** CSV com ";" e BOM — abre direto no Excel em pt-BR. */
export function toCSV<T>(rows: T[], columns: { label: string; get: (r: T) => unknown }[]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(';'), ...rows.map((r) => columns.map((c) => esc(c.get(r))).join(';'))];
  return '﻿' + lines.join('\r\n');
}

export function download(filename: string, content: string | Blob, type = 'text/csv;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
