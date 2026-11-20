import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { norm } from '../lib/format';
import type { Product } from '../lib/types';
import { Input, cx } from './ui';

/** Busca de produto por nome, SKU ou EAN (aceita bipagem). */
export function ProductPicker({ value, onChange }: { value: Product | null; onChange: (p: Product | null) => void }) {
  const { products, findByCode } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const t = norm(q);
    if (!t) return products.slice(0, 8);
    return products.filter((p) => norm(`${p.name} ${p.sku} ${p.ean}`).includes(t)).slice(0, 8);
  }, [q, products]);

  if (value)
    return (
      <div className="flex h-10 items-center justify-between rounded-xl border border-line bg-surface px-3 text-sm">
        <span className="truncate">
          {value.name} <span className="text-faint">· {value.sku}</span>
        </span>
        <button type="button" className="text-brand text-xs font-medium" onClick={() => onChange(null)}>
          trocar
        </button>
      </div>
    );

  return (
    <div className="relative">
      <Input
        value={q}
        placeholder="Buscar ou bipar produto…"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const hit = findByCode(q) ?? results[0];
            if (hit) onChange(hit);
          }
        }}
      />
      {open && results.length > 0 && (
        <div className="card absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-xl p-1 shadow-lg">
          {results.map((p) => (
            <button
              type="button"
              key={p.id}
              className={cx('flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-hover')}
              onMouseDown={() => onChange(p)}
            >
              <span className="truncate">{p.name}</span>
              <span className="text-faint shrink-0 text-xs">
                {p.sku} · {p.stock} un
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
