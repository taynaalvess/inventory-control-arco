import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { blankProduct, kitCost, useStore } from '../lib/store';
import { brl, errMsg } from '../lib/format';
import type { Product } from '../lib/types';
import { Button, Field, Input, Modal, Select } from './ui';
import { ProductPicker } from './ProductPicker';
import { useToast } from './toast';

export function ProductForm({
  open,
  onClose,
  product,
  preset,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  product?: Product | null;
  preset?: Partial<Product>;
  onSaved?: (p: Product) => void;
}) {
  const { saveProduct, products, suppliers, productById } = useStore();
  const toast = useToast();
  const [p, setP] = useState<Product>(() => blankProduct());
  const [initial, setInitial] = useState('0');
  const [busy, setBusy] = useState(false);
  const isNew = !product;

  useEffect(() => {
    if (open) {
      setP(product ? { ...product, kitItems: [...product.kitItems] } : blankProduct(preset));
      setInitial('0');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product]);

  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP((x) => ({ ...x, [k]: v }));
  const numVal = (v: string) => (v === '' ? 0 : Number(v.replace(',', '.')) || 0);
  const categories = useMemo(() => [...new Set(products.map((x) => x.category).filter(Boolean))].sort(), [products]);
  const computedKitCost = p.isKit ? kitCost(p, productById) : 0;

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      const final = p.isKit ? { ...p, cost: Math.round(computedKitCost * 100) / 100, minStock: 0 } : p;
      const saved = await saveProduct(final, isNew ? Math.round(numVal(initial)) : 0);
      toast(isNew ? 'Produto cadastrado' : 'Produto atualizado');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  const cost = p.isKit ? computedKitCost : p.cost;
  const margin = p.price > 0 ? (p.price - cost) / p.price : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? 'Novo produto' : 'Editar produto'}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => submit()} disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-6">
        <Field label="Nome *" className="sm:col-span-6">
          <Input autoFocus value={p.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Fone Bluetooth TWS" />
        </Field>
        <Field label="SKU *" className="sm:col-span-3" hint="Mesmo SKU usado no UpSeller/marketplaces">
          <Input value={p.sku} onChange={(e) => set('sku', e.target.value)} placeholder="ARC-001" />
        </Field>
        <Field label="Código de barras (EAN)" className="sm:col-span-3" hint="Bipe aqui para preencher">
          <Input value={p.ean} onChange={(e) => set('ean', e.target.value)} placeholder="7890000000000" inputMode="numeric" />
        </Field>

        <label className="flex items-center gap-2 rounded-xl border border-line p-3 text-sm sm:col-span-6">
          <input type="checkbox" checked={p.isKit} onChange={(e) => set('isKit', e.target.checked)} className="accent-brand h-4 w-4" disabled={!isNew && p.stock !== 0} />
          <span>
            <b>É um kit / combo</b> <span className="text-muted">— não tem estoque próprio; vender o kit baixa cada componente.</span>
            {!isNew && p.stock !== 0 && <span className="text-faint block text-xs">Zere o saldo deste produto antes de transformá-lo em kit.</span>}
          </span>
        </label>

        {p.isKit && (
          <div className="space-y-2 sm:col-span-6">
            <p className="text-muted text-xs font-medium">Componentes</p>
            {p.kitItems.map((it, i) => {
              const c = productById.get(it.productId);
              return (
                <div key={it.productId} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-xl border border-line px-3 py-2 text-sm">
                    {c?.name ?? 'Produto removido'} <span className="text-faint">· {c?.sku} · {brl(c?.cost ?? 0)}</span>
                  </span>
                  <Input
                    type="number"
                    min={1}
                    className="w-20"
                    value={it.qty}
                    onChange={(e) => set('kitItems', p.kitItems.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Math.round(Number(e.target.value) || 1)) } : x)))}
                    aria-label="Quantidade"
                  />
                  <button type="button" className="text-muted rounded-lg p-2 hover:bg-hover hover:text-rose-500" onClick={() => set('kitItems', p.kitItems.filter((_, j) => j !== i))} aria-label="Remover">
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
            <ProductPicker
              value={null}
              filter={(x) => !x.isKit && x.id !== p.id && !p.kitItems.some((it) => it.productId === x.id)}
              onChange={(x) => x && set('kitItems', [...p.kitItems, { productId: x.id, qty: 1 }])}
              placeholder="Adicionar componente…"
            />
          </div>
        )}

        <Field label="Categoria" className="sm:col-span-2">
          <Input value={p.category} onChange={(e) => set('category', e.target.value)} list="cat-list" />
          <datalist id="cat-list">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Marca" className="sm:col-span-2">
          <Input value={p.brand} onChange={(e) => set('brand', e.target.value)} />
        </Field>
        <Field label="Localização" className="sm:col-span-2" hint="Rua/prateleira">
          <Input value={p.location} onChange={(e) => set('location', e.target.value)} placeholder="A1-P2" disabled={p.isKit} />
        </Field>
        <Field label="Custo (R$)" className="sm:col-span-2" hint={p.isKit ? 'Soma dos componentes' : 'Atualizado pelo custo médio nas entradas'}>
          <Input type="number" step="0.01" min="0" value={p.isKit ? computedKitCost.toFixed(2) : p.cost || ''} disabled={p.isKit} onChange={(e) => set('cost', numVal(e.target.value))} />
        </Field>
        <Field label="Preço de venda (R$)" className="sm:col-span-2" hint={p.price ? `Margem bruta: ${(margin * 100).toFixed(1)}%` : undefined}>
          <Input type="number" step="0.01" min="0" value={p.price || ''} onChange={(e) => set('price', numVal(e.target.value))} />
        </Field>
        {!p.isKit && (
          <Field label="Estoque mínimo" className="sm:col-span-2" hint="Gera alerta de reposição">
            <Input type="number" min="0" value={p.minStock || ''} onChange={(e) => set('minStock', Math.round(numVal(e.target.value)))} />
          </Field>
        )}
        {!p.isKit && (
          <>
            <Field label="Fornecedor" className="sm:col-span-2">
              <Select value={p.supplierId} onChange={(e) => set('supplierId', e.target.value)}>
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Prazo de entrega (dias)" className="sm:col-span-2" hint="Vazio = prazo do fornecedor">
              <Input type="number" min="0" value={p.leadTimeDays || ''} onChange={(e) => set('leadTimeDays', Math.round(numVal(e.target.value)))} />
            </Field>
            {isNew ? (
              <Field label="Estoque inicial" className="sm:col-span-2" hint="Registrado como ajuste">
                <Input type="number" value={initial} onChange={(e) => setInitial(e.target.value)} />
              </Field>
            ) : (
              <Field label="Estoque atual" className="sm:col-span-2" hint="Altere pela bipagem ou movimentações">
                <Input value={p.stock} disabled />
              </Field>
            )}
          </>
        )}
        <Field label="URL da imagem" className="sm:col-span-6">
          <Input value={p.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…" />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-6">
          <input type="checkbox" checked={p.active} onChange={(e) => set('active', e.target.checked)} className="accent-brand h-4 w-4" />
          Produto ativo
        </label>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
