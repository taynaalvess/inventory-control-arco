import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Package, Pencil, Plus, Printer, Search, Tag, Trash2 } from 'lucide-react';
import { useStore } from '../lib/store';
import { brl, errMsg, norm } from '../lib/format';
import { download, stamp, toCSV } from '../lib/files';
import { printLabels } from '../lib/labels';
import type { Product } from '../lib/types';
import { ProductForm } from '../components/ProductForm';
import { Badge, Button, Card, Empty, Input, PageHeader, Segmented, Select, StockBadge } from '../components/ui';
import { useToast } from '../components/toast';

type Filter = 'todos' | 'baixo' | 'zerado' | 'inativos';

export default function Products() {
  const { products, deleteProduct, movements } = useStore();
  const toast = useToast();
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>((params.get('f') as Filter) || 'todos');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<'name' | 'stock' | 'value'>('name');

  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(), [products]);

  const list = useMemo(() => {
    const t = norm(q);
    return products
      .filter((p) => {
        if (filter === 'inativos') {
          if (p.active) return false;
        } else if (!p.active) return false;
        if (filter === 'baixo' && !(p.stock <= 0 || (p.minStock > 0 && p.stock <= p.minStock))) return false;
        if (filter === 'zerado' && p.stock > 0) return false;
        if (category && p.category !== category) return false;
        if (t && !norm(`${p.name} ${p.sku} ${p.ean} ${p.location} ${p.brand}`).includes(t)) return false;
        return true;
      })
      .sort((a, b) =>
        sort === 'stock' ? a.stock - b.stock : sort === 'value' ? b.stock * b.cost - a.stock * a.cost : a.name.localeCompare(b.name, 'pt-BR'),
      );
  }, [products, q, filter, category, sort]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function remove(p: Product) {
    const count = movements.filter((m) => m.productId === p.id).length;
    const msg = count
      ? `Excluir "${p.name}" e suas ${count} movimentações? Isso afeta o histórico e as métricas. Para apenas esconder, desative o produto.`
      : `Excluir "${p.name}"?`;
    if (!window.confirm(msg)) return;
    try {
      await deleteProduct(p.id);
      toast('Produto excluído');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  function exportCsv() {
    const csv = toCSV(list, [
      { label: 'SKU', get: (p) => p.sku },
      { label: 'EAN', get: (p) => p.ean },
      { label: 'Nome', get: (p) => p.name },
      { label: 'Categoria', get: (p) => p.category },
      { label: 'Marca', get: (p) => p.brand },
      { label: 'Localização', get: (p) => p.location },
      { label: 'Custo', get: (p) => p.cost },
      { label: 'Preço', get: (p) => p.price },
      { label: 'Estoque', get: (p) => p.stock },
      { label: 'Estoque mínimo', get: (p) => p.minStock },
      { label: 'Valor em estoque', get: (p) => +(p.stock * p.cost).toFixed(2) },
      { label: 'Ativo', get: (p) => (p.active ? 'Sim' : 'Não') },
    ]);
    download(`produtos-${stamp()}.csv`, csv);
  }

  function labels() {
    const items = products.filter((p) => selected.has(p.id)).map((p) => ({ product: p, copies: 1 }));
    if (!items.length) return toast('Selecione produtos para imprimir etiquetas', 'info');
    const copies = Number(window.prompt('Quantas etiquetas de cada produto?', '1'));
    if (!copies || copies < 1) return;
    printLabels(items.map((i) => ({ ...i, copies: Math.min(500, Math.round(copies)) })));
  }

  const allSelected = list.length > 0 && list.every((p) => selected.has(p.id));

  return (
    <>
      <PageHeader
        title="Produtos"
        subtitle={`${products.filter((p) => p.active).length} ativos · ${list.length} exibidos`}
        actions={
          <>
            <Button variant="secondary" onClick={labels} disabled={!selected.size}>
              <Printer size={16} /> Etiquetas {selected.size ? `(${selected.size})` : ''}
            </Button>
            <Button variant="secondary" onClick={exportCsv}>
              <Download size={16} /> Exportar
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> Novo produto
            </Button>
          </>
        }
      />

      <Card className="mb-4 flex flex-wrap items-center gap-3 p-3 sm:p-3">
        <div className="relative min-w-52 flex-1">
          <Search size={16} className="text-faint absolute top-1/2 left-3 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, SKU, EAN, local… (aceita bipagem)" className="pl-9" />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto">
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-auto">
          <option value="name">Ordenar: nome</option>
          <option value="stock">Ordenar: menor saldo</option>
          <option value="value">Ordenar: maior valor</option>
        </Select>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'todos', label: 'Todos' },
            { value: 'baixo', label: 'Repor' },
            { value: 'zerado', label: 'Zerados' },
            { value: 'inativos', label: 'Inativos' },
          ]}
        />
      </Card>

      <Card className="p-0 sm:p-0">
        {list.length === 0 ? (
          <Empty
            icon={<Package size={36} />}
            title={products.length ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado'}
            text={products.length ? 'Ajuste a busca ou os filtros.' : 'Cadastre manualmente ou importe a planilha de produtos do UpSeller.'}
            action={!products.length && <Button onClick={() => setCreating(true)}>Cadastrar produto</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(list.map((p) => p.id)))}
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th>Produto</th>
                  <th>EAN</th>
                  <th>Categoria</th>
                  <th>Local</th>
                  <th className="text-right">Custo</th>
                  <th className="text-right">Preço</th>
                  <th className="text-right">Saldo</th>
                  <th className="text-right">Mín.</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 500).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <input type="checkbox" className="accent-brand" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Selecionar ${p.name}`} />
                    </td>
                    <td className="max-w-72">
                      <button className="block max-w-full truncate text-left font-medium hover:underline" onClick={() => setEditing(p)}>
                        {p.name}
                      </button>
                      <div className="text-faint flex items-center gap-1 text-xs">
                        <Tag size={11} /> {p.sku} {!p.active && <Badge>inativo</Badge>}
                      </div>
                    </td>
                    <td className="text-muted font-mono text-xs">{p.ean || '—'}</td>
                    <td className="text-muted">{p.category || '—'}</td>
                    <td className="text-muted">{p.location || '—'}</td>
                    <td className="text-right tabular-nums">{brl(p.cost)}</td>
                    <td className="text-right tabular-nums">{brl(p.price)}</td>
                    <td className="text-right">
                      <StockBadge stock={p.stock} min={p.minStock} />
                    </td>
                    <td className="text-muted text-right tabular-nums">{p.minStock || '—'}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <button className="text-muted rounded-lg p-1.5 hover:bg-hover" onClick={() => printLabels([{ product: p, copies: 1 }])} title="Imprimir etiqueta">
                          <Printer size={15} />
                        </button>
                        <button className="text-muted rounded-lg p-1.5 hover:bg-hover" onClick={() => setEditing(p)} title="Editar">
                          <Pencil size={15} />
                        </button>
                        <button className="text-muted rounded-lg p-1.5 hover:bg-hover hover:text-rose-500" onClick={() => remove(p)} title="Excluir">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length > 500 && <p className="text-muted p-3 text-center text-xs">Mostrando 500 de {list.length}. Refine a busca.</p>}
          </div>
        )}
      </Card>

      <ProductForm open={creating || !!editing} product={editing} onClose={() => (setCreating(false), setEditing(null))} />
    </>
  );
}
