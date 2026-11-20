import { useMemo, useState } from 'react';
import { ArrowLeftRight, Download, Plus, Search, Undo2 } from 'lucide-react';
import { useStore } from '../lib/store';
import { brl, dateTime, errMsg, norm } from '../lib/format';
import { download, stamp, toCSV } from '../lib/files';
import { MOVEMENT_LABEL, SOURCE_LABEL, type Movement, type MovementType, type Product } from '../lib/types';
import { ProductPicker } from '../components/ProductPicker';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select } from '../components/ui';
import { useToast } from '../components/toast';

const TONE: Record<MovementType, 'green' | 'red' | 'violet' | 'amber' | 'blue'> = {
  entrada: 'green',
  saida: 'red',
  venda: 'violet',
  devolucao: 'amber',
  ajuste: 'blue',
};

export default function Movements() {
  const { movements, productById, storeById, stores, addMovements, can } = useStore();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [storeId, setStoreId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(200);
  const [creating, setCreating] = useState(false);

  const list = useMemo(() => {
    const t = norm(q);
    const f = from ? new Date(`${from}T00:00:00`).getTime() : 0;
    const tt = to ? new Date(`${to}T23:59:59`).getTime() : Infinity;
    return movements
      .filter((m) => {
        if (type && m.type !== type) return false;
        if (storeId && m.storeId !== storeId) return false;
        const at = new Date(m.createdAt).getTime();
        if (at < f || at > tt) return false;
        if (t) {
          const p = productById.get(m.productId);
          if (!norm(`${p?.name} ${p?.sku} ${p?.ean} ${m.ref} ${m.note}`).includes(t)) return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [movements, q, type, storeId, from, to, productById]);

  async function reverse(m: Movement) {
    const p = productById.get(m.productId);
    if (!window.confirm(`Estornar ${MOVEMENT_LABEL[m.type].toLowerCase()} de ${Math.abs(m.qty)} un de "${p?.name}"?`)) return;
    try {
      await addMovements([
        m.type === 'venda'
          ? { productId: m.productId, type: 'devolucao', qty: -m.qty, unitPrice: m.unitPrice, unitCost: m.unitCost, storeId: m.storeId, ref: m.ref, note: `Estorno da venda ${m.ref}`, affectsStock: m.affectsStock }
          : { productId: m.productId, type: 'ajuste', qty: -m.qty, ref: m.ref, note: `Estorno: ${MOVEMENT_LABEL[m.type]} ${dateTime(m.createdAt)}`, affectsStock: m.affectsStock },
      ]);
      toast('Movimentação estornada');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  function exportCsv() {
    download(
      `movimentacoes-${stamp()}.csv`,
      toCSV(list, [
        { label: 'Data', get: (m) => dateTime(m.createdAt) },
        { label: 'Tipo', get: (m) => MOVEMENT_LABEL[m.type] },
        { label: 'SKU', get: (m) => productById.get(m.productId)?.sku },
        { label: 'Produto', get: (m) => productById.get(m.productId)?.name },
        { label: 'Quantidade', get: (m) => m.qty },
        { label: 'Preço unit.', get: (m) => m.unitPrice ?? '' },
        { label: 'Loja', get: (m) => (m.storeId ? storeById.get(m.storeId)?.name : '') },
        { label: 'Referência', get: (m) => m.ref },
        { label: 'Origem', get: (m) => SOURCE_LABEL[m.source] },
        { label: 'Baixa estoque', get: (m) => (m.affectsStock ? 'Sim' : 'Não') },
        { label: 'Observação', get: (m) => m.note },
      ]),
    );
  }

  return (
    <>
      <PageHeader
        title="Movimentações"
        subtitle="Histórico completo e auditável de entradas, saídas, vendas e ajustes"
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv}>
              <Download size={16} /> Exportar
            </Button>
            {can('scan') && (
              <Button onClick={() => setCreating(true)}>
                <Plus size={16} /> Lançamento manual
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-4 grid grid-cols-2 gap-3 p-3 sm:grid-cols-6 sm:p-3">
        <div className="relative col-span-2">
          <Search size={16} className="text-faint absolute top-1/2 left-3 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Produto, pedido, observação…" className="pl-9" />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Todos os tipos</option>
          {Object.entries(MOVEMENT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">Todas as lojas</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Até" />
      </Card>

      <Card className="p-0 sm:p-0">
        {list.length === 0 ? (
          <Empty icon={<ArrowLeftRight size={36} />} title="Nenhuma movimentação" text="As movimentações aparecem aqui ao bipar, importar ou lançar manualmente." />
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Produto</th>
                  <th className="text-right">Qtd.</th>
                  <th className="text-right">Valor</th>
                  <th>Loja</th>
                  <th>Ref.</th>
                  <th>Origem</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.slice(0, limit).map((m) => {
                  const p = productById.get(m.productId);
                  const st = m.storeId ? storeById.get(m.storeId) : null;
                  return (
                    <tr key={m.id}>
                      <td className="text-muted whitespace-nowrap">{dateTime(m.createdAt)}</td>
                      <td>
                        <Badge tone={TONE[m.type]}>{MOVEMENT_LABEL[m.type]}</Badge>
                        {!m.affectsStock && <Badge className="ml-1">só métrica</Badge>}
                      </td>
                      <td className="max-w-64">
                        <div className="truncate">{p?.name ?? '—'}</div>
                        <div className="text-faint truncate text-xs">{m.note || p?.sku}</div>
                      </td>
                      <td className={`text-right font-medium tabular-nums ${m.qty > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {m.qty > 0 ? '+' : ''}
                        {m.qty}
                      </td>
                      <td className="text-right tabular-nums">{can('finance') && m.unitPrice ? brl(Math.abs(m.qty) * m.unitPrice) : '—'}</td>
                      <td className="whitespace-nowrap">
                        {st ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ background: st.color }} />
                            {st.name}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-muted font-mono text-xs">{m.ref || '—'}</td>
                      <td className="text-muted text-xs">{SOURCE_LABEL[m.source]}</td>
                      <td>
                        {can('manage') && m.source !== 'kit' && (
                          <button className="text-muted rounded-lg p-1.5 hover:bg-hover" onClick={() => reverse(m)} title="Estornar">
                            <Undo2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {list.length > limit && (
              <div className="p-3 text-center">
                <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + 500)}>
                  Carregar mais ({list.length - limit} restantes)
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      <ManualMovement open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function ManualMovement({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { stores, addMovements } = useStore();
  const toast = useToast();
  const [product, setProduct] = useState<Product | null>(null);
  const [type, setType] = useState<MovementType>('entrada');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [storeId, setStoreId] = useState('');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!product) return toast('Escolha o produto', 'error');
    const n = Math.round(Number(qty));
    if (!n) return toast('Informe a quantidade', 'error');
    const signed = type === 'ajuste' ? n : type === 'entrada' || type === 'devolucao' ? Math.abs(n) : -Math.abs(n);
    setBusy(true);
    try {
      await addMovements([
        {
          productId: product.id,
          type,
          qty: signed,
          unitPrice: type === 'venda' || type === 'devolucao' ? Number(price.replace(',', '.')) || product.price : null,
          unitCost: product.cost,
          storeId: storeId || null,
          ref,
          note,
          createdAt: date ? new Date(`${date}T12:00:00`).toISOString() : undefined,
        },
      ]);
      toast('Movimentação registrada');
      setProduct(null);
      setQty('1');
      setPrice('');
      setRef('');
      setNote('');
      onClose();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Lançamento manual"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Produto" className="col-span-2">
          <ProductPicker value={product} onChange={setProduct} />
        </Field>
        <Field label="Tipo">
          <Select value={type} onChange={(e) => setType(e.target.value as MovementType)}>
            {Object.entries(MOVEMENT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quantidade" hint={type === 'ajuste' ? 'Use negativo para reduzir' : undefined}>
          <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        {(type === 'venda' || type === 'devolucao') && (
          <>
            <Field label="Preço unitário">
              <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={product ? String(product.price) : ''} />
            </Field>
            <Field label="Loja">
              <Select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">Sem loja</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <Field label="Referência">
          <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="NF, pedido…" />
        </Field>
        <Field label="Data" hint="vazio = agora">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Observação" className="col-span-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
