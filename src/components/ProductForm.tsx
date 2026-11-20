import { useEffect, useState } from 'react';
import { blankProduct, useStore } from '../lib/store';
import { errMsg } from '../lib/format';
import type { Product } from '../lib/types';
import { Button, Field, Input, Modal } from './ui';
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
  const { saveProduct, products } = useStore();
  const toast = useToast();
  const [p, setP] = useState<Product>(() => blankProduct());
  const [initial, setInitial] = useState('0');
  const [busy, setBusy] = useState(false);
  const isNew = !product;

  useEffect(() => {
    if (open) {
      setP(product ? { ...product } : blankProduct(preset));
      setInitial('0');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product]);

  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP((x) => ({ ...x, [k]: v }));
  const numVal = (v: string) => (v === '' ? 0 : Number(v.replace(',', '.')) || 0);
  const categories = [...new Set(products.map((x) => x.category).filter(Boolean))].sort();

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      const saved = await saveProduct(p, isNew ? Math.round(numVal(initial)) : 0);
      toast(isNew ? 'Produto cadastrado' : 'Produto atualizado');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  const margin = p.price > 0 ? (p.price - p.cost) / p.price : 0;

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
          <Input value={p.location} onChange={(e) => set('location', e.target.value)} placeholder="A1-P2" />
        </Field>
        <Field label="Custo (R$)" className="sm:col-span-2">
          <Input type="number" step="0.01" min="0" value={p.cost || ''} onChange={(e) => set('cost', numVal(e.target.value))} />
        </Field>
        <Field label="Preço de venda (R$)" className="sm:col-span-2" hint={p.price ? `Margem bruta: ${(margin * 100).toFixed(1)}%` : undefined}>
          <Input type="number" step="0.01" min="0" value={p.price || ''} onChange={(e) => set('price', numVal(e.target.value))} />
        </Field>
        <Field label="Estoque mínimo" className="sm:col-span-2" hint="Gera alerta de reposição">
          <Input type="number" min="0" value={p.minStock || ''} onChange={(e) => set('minStock', Math.round(numVal(e.target.value)))} />
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
        <Field label="URL da imagem" className="sm:col-span-4">
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
