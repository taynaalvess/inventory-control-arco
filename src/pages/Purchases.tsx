import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, ClipboardList, FileCode2, FileText, Lightbulb, PackageCheck, Pencil, Plus, ScanBarcode, Send, Trash2, Truck, XCircle } from 'lucide-react';
import { useStore } from '../lib/store';
import { dailyConsumption } from '../lib/metrics';
import { beep } from '../lib/feedback';
import { brl, dateTime, errMsg, num, uid } from '../lib/format';
import { download, stamp, toCSV } from '../lib/files';
import { PURCHASE_LABEL, type Purchase, type PurchaseStatus } from '../lib/types';
import { ProductPicker } from '../components/ProductPicker';
import { NfeImport } from '../components/NfeImport';
import { SuppliersTab } from './Suppliers';
import { Badge, Button, Card, CardTitle, Empty, Field, Input, Modal, PageHeader, Segmented, Select, cx } from '../components/ui';
import { useToast } from '../components/toast';

const STATUS_TONE: Record<PurchaseStatus, 'neutral' | 'blue' | 'amber' | 'green' | 'red'> = {
  rascunho: 'neutral',
  enviado: 'blue',
  parcial: 'amber',
  recebido: 'green',
  cancelado: 'red',
};

const total = (p: Purchase) => p.items.reduce((s, it) => s + it.qty * it.unitCost, 0);
const progress = (p: Purchase) => {
  const q = p.items.reduce((s, it) => s + it.qty, 0);
  return q ? p.items.reduce((s, it) => s + Math.min(it.received, it.qty), 0) / q : 0;
};

export default function Purchases() {
  const { can } = useStore();
  const [tab, setTab] = useState<'pedidos' | 'sugestao' | 'fornecedores'>('pedidos');
  return (
    <>
      <PageHeader
        title="Compras"
        subtitle="Pedidos a fornecedores, recebimento por bipagem e reposição inteligente"
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'pedidos', label: 'Pedidos' },
              ...(can('manage')
                ? [
                    { value: 'sugestao' as const, label: 'Sugestão de compra' },
                    { value: 'fornecedores' as const, label: 'Fornecedores' },
                  ]
                : []),
            ]}
          />
        }
      />
      {tab === 'pedidos' && <Orders />}
      {tab === 'sugestao' && <Suggestion onCreated={() => setTab('pedidos')} />}
      {tab === 'fornecedores' && <SuppliersTab />}
    </>
  );
}

/* =============================== PEDIDOS =============================== */

function Orders() {
  const { purchases, supplierById, can, savePurchase, deletePurchase } = useStore();
  const toast = useToast();
  const [status, setStatus] = useState<'abertos' | 'todos'>('abertos');
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<Purchase | null>(null);
  const [importing, setImporting] = useState(false);
  const finance = can('finance');

  const list = useMemo(
    () =>
      purchases
        .filter((p) => status === 'todos' || ['rascunho', 'enviado', 'parcial'].includes(p.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [purchases, status],
  );

  async function setPoStatus(p: Purchase, s: PurchaseStatus) {
    try {
      await savePurchase({ ...p, status: s });
      toast(`Pedido ${p.number}: ${PURCHASE_LABEL[s].toLowerCase()}`);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'abertos', label: 'Em aberto' },
            { value: 'todos', label: 'Todos' },
          ]}
        />
        {can('manage') && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <FileCode2 size={16} /> Importar NF-e (XML)
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> Novo pedido
            </Button>
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <Card>
          <Empty
            icon={<ClipboardList size={36} />}
            title="Nenhum pedido de compra"
            text="Importe o XML da NF-e para lançar a entrada direto no estoque, crie um pedido manualmente ou use a Sugestão de compra."
            action={can('manage') && <Button onClick={() => setImporting(true)}><FileCode2 size={16} /> Importar NF-e</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold">{p.number}</div>
                  <div className="text-muted truncate text-sm">{supplierById.get(p.supplierId)?.name ?? 'Sem fornecedor'}</div>
                </div>
                <Badge tone={STATUS_TONE[p.status]}>{PURCHASE_LABEL[p.status]}</Badge>
              </div>
              <div className="text-muted mt-3 grid grid-cols-2 gap-2 text-xs">
                <span>{p.items.length} item(ns) · {num(p.items.reduce((s, it) => s + it.qty, 0))} un</span>
                {finance && <span className="text-right font-medium text-[var(--text)]">{brl(total(p))}</span>}
                <span>Criado {dateTime(p.createdAt)}</span>
                {p.expectedAt && <span className="text-right">Previsto {new Date(`${p.expectedAt}T12:00:00`).toLocaleDateString('pt-BR')}</span>}
              </div>
              {p.invoiceNumber && (
                <div className="mt-2 flex items-center gap-1.5 text-xs" title={p.invoiceKey ? `Chave: ${p.invoiceKey}` : undefined}>
                  <FileText size={12} className="text-brand" />
                  <span>
                    NF-e {p.invoiceNumber}
                    {p.invoiceDate && ` · ${new Date(`${p.invoiceDate}T12:00:00`).toLocaleDateString('pt-BR')}`}
                    {finance && p.invoiceTotal > 0 && ` · ${brl(p.invoiceTotal)}`}
                  </span>
                </div>
              )}
              {(p.status === 'parcial' || p.status === 'recebido') && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--hover)]">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress(p) * 100}%` }} />
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {['enviado', 'parcial'].includes(p.status) && (
                  <Button size="sm" onClick={() => setReceiving(p)}>
                    <PackageCheck size={14} /> Receber
                  </Button>
                )}
                {p.status === 'rascunho' && can('manage') && (
                  <Button size="sm" onClick={() => setPoStatus(p, 'enviado')}>
                    <Send size={14} /> Marcar enviado
                  </Button>
                )}
                {['rascunho', 'enviado'].includes(p.status) && can('manage') && (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                    <Pencil size={14} /> Editar
                  </Button>
                )}
                {p.status === 'parcial' && can('manage') && (
                  <Button size="sm" variant="secondary" onClick={() => window.confirm('Encerrar o pedido com o que já foi recebido?') && setPoStatus(p, 'recebido')}>
                    <CheckCheck size={14} /> Encerrar
                  </Button>
                )}
                {['rascunho', 'enviado'].includes(p.status) && can('manage') && (
                  <Button size="sm" variant="ghost" onClick={() => window.confirm(`Cancelar o pedido ${p.number}?`) && setPoStatus(p, 'cancelado')}>
                    <XCircle size={14} /> Cancelar
                  </Button>
                )}
                {['rascunho', 'cancelado'].includes(p.status) && can('manage') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!window.confirm(`Excluir o pedido ${p.number}?`)) return;
                      try {
                        await deletePurchase(p.id);
                        toast('Pedido excluído');
                      } catch (e) {
                        toast(errMsg(e), 'error');
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <PurchaseForm open={creating || !!editing} purchase={editing} onClose={() => (setCreating(false), setEditing(null))} />
      <ReceiveModal purchase={receiving} onClose={() => setReceiving(null)} />
      <NfeImport open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

function PurchaseForm({ open, onClose, purchase }: { open: boolean; onClose: () => void; purchase: Purchase | null }) {
  const { suppliers, productById, savePurchase, nextPurchaseNumber } = useStore();
  const toast = useToast();
  const [p, setP] = useState<Purchase | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return setP(null);
    const now = new Date().toISOString();
    setP(purchase ? { ...purchase, items: purchase.items.map((i) => ({ ...i })) } : { id: uid(), number: nextPurchaseNumber(), supplierId: '', status: 'rascunho', items: [], expectedAt: '', notes: '', invoiceNumber: '', invoiceKey: '', invoiceDate: '', invoiceTotal: 0, createdAt: now, updatedAt: now });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, purchase]);

  if (!open || !p) return null;

  async function submit() {
    setBusy(true);
    try {
      await savePurchase(p!);
      toast(purchase ? 'Pedido atualizado' : `Pedido ${p!.number} criado`);
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
      title={purchase ? `Editar ${p.number}` : `Novo pedido ${p.number}`}
      wide
      footer={
        <>
          <span className="text-muted mr-auto self-center text-sm">Total: {brl(total(p))}</span>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Fornecedor">
          <Select value={p.supplierId} onChange={(e) => setP({ ...p, supplierId: e.target.value })}>
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Previsão de entrega">
          <Input type="date" value={p.expectedAt} onChange={(e) => setP({ ...p, expectedAt: e.target.value })} />
        </Field>
        <Field label="Observações">
          <Input value={p.notes} onChange={(e) => setP({ ...p, notes: e.target.value })} />
        </Field>
      </div>

      <div className="mt-5 space-y-2">
        <p className="text-muted text-xs font-medium">Itens</p>
        {p.items.map((it, i) => {
          const prod = productById.get(it.productId);
          const upd = (patch: Partial<typeof it>) => setP({ ...p, items: p.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={it.productId} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
              <span className="min-w-0 truncate rounded-xl border border-line px-3 py-2 text-sm">
                {prod?.name ?? '—'} <span className="text-faint">· {prod?.sku}</span>
              </span>
              <Input type="number" min={1} className="w-20" value={it.qty} onChange={(e) => upd({ qty: Math.max(1, Math.round(Number(e.target.value) || 1)) })} aria-label="Quantidade" />
              <Input type="number" min={0} step="0.01" className="w-28" value={it.unitCost} onChange={(e) => upd({ unitCost: Number(e.target.value) || 0 })} aria-label="Custo unitário" />
              <button className="text-muted rounded-lg p-2 hover:bg-hover hover:text-rose-500" onClick={() => setP({ ...p, items: p.items.filter((_, j) => j !== i) })} aria-label="Remover">
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
        <ProductPicker
          value={null}
          filter={(x) => !x.isKit && !p.items.some((it) => it.productId === x.id)}
          onChange={(x) => x && setP({ ...p, supplierId: p.supplierId || x.supplierId, items: [...p.items, { productId: x.id, qty: 1, received: 0, unitCost: x.cost }] })}
          placeholder="Adicionar produto (busque ou bipe)…"
        />
        {p.items.length > 0 && <p className="text-faint text-xs">Colunas: quantidade · custo unitário (R$)</p>}
      </div>
    </Modal>
  );
}

function ReceiveModal({ purchase, onClose }: { purchase: Purchase | null; onClose: () => void }) {
  const { productById, findByCode, receivePurchase, can } = useStore();
  const toast = useToast();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQty({});
    setCode('');
  }, [purchase]);

  if (!purchase) return null;
  const remaining = (pid: string) => {
    const it = purchase.items.find((x) => x.productId === pid)!;
    return Math.max(0, it.qty - it.received);
  };

  function scan(c: string) {
    const p = findByCode(c.trim());
    if (!p || !purchase!.items.some((it) => it.productId === p.id)) {
      beep('error');
      toast(p ? `${p.name} não está neste pedido` : `Código ${c} não encontrado`, 'error');
      return;
    }
    beep('ok');
    setQty((q) => ({ ...q, [p.id]: (q[p.id] ?? 0) + 1 }));
  }

  async function confirm() {
    setBusy(true);
    try {
      const receipts = Object.entries(qty).map(([productId, n]) => ({ productId, qty: n }));
      const over = receipts.filter((r) => r.qty > remaining(r.productId));
      if (over.length && !window.confirm(`${over.length} item(ns) acima do pedido. Receber mesmo assim?`)) return setBusy(false);
      await receivePurchase(purchase!, receipts);
      beep('done');
      toast(`Recebimento de ${purchase!.number} registrado no estoque`);
      onClose();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const totalNow = Object.values(qty).reduce((s, n) => s + n, 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Receber ${purchase.number}`}
      wide
      footer={
        <>
          <Button variant="secondary" className="mr-auto" onClick={() => setQty(Object.fromEntries(purchase.items.map((it) => [it.productId, remaining(it.productId)])))}>
            Receber tudo que falta
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={busy || !totalNow}>
            Confirmar {totalNow ? `(${num(totalNow)} un)` : ''}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code) scan(code);
          setCode('');
          inputRef.current?.focus();
        }}
        className="relative mb-4"
      >
        <ScanBarcode size={18} className="text-faint absolute top-1/2 left-3 -translate-y-1/2" />
        <Input ref={inputRef} autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Bipe os produtos conforme confere a mercadoria…" className="h-12 pl-10" />
      </form>
      <div className="-mx-3 overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th>Produto</th>
              <th className="text-right">Pedido</th>
              <th className="text-right">Já recebido</th>
              <th className="text-right">Receber agora</th>
              {can('finance') && <th className="text-right">Custo</th>}
            </tr>
          </thead>
          <tbody>
            {purchase.items.map((it) => {
              const p = productById.get(it.productId);
              const now = qty[it.productId] ?? 0;
              return (
                <tr key={it.productId} className={cx(now > 0 && now + it.received >= it.qty && 'bg-emerald-500/5')}>
                  <td className="max-w-64 truncate">{p?.name ?? '—'}</td>
                  <td className="text-right tabular-nums">{it.qty}</td>
                  <td className="text-right tabular-nums">{it.received}</td>
                  <td className="text-right">
                    <input
                      className={cx('h-8 w-20 rounded-lg border bg-surface text-center text-sm tabular-nums', now > remaining(it.productId) ? 'border-amber-500' : 'border-line')}
                      value={now}
                      inputMode="numeric"
                      onChange={(e) => setQty((q) => ({ ...q, [it.productId]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                    />
                  </td>
                  {can('finance') && <td className="text-right tabular-nums">{brl(it.unitCost)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-faint mt-3 text-xs">Ao confirmar: entradas no estoque com o custo do pedido (atualiza o custo médio) e referência {purchase.number}.</p>
    </Modal>
  );
}

/* ============================== SUGESTÃO ============================== */

function Suggestion({ onCreated }: { onCreated: () => void }) {
  const { products, movements, purchases, suppliers, supplierById, savePurchase, nextPurchaseNumber } = useStore();
  const toast = useToast();
  const [coverage, setCoverage] = useState(30);
  const [defaultLead, setDefaultLead] = useState(7);
  const [selected, setSelected] = useState<Record<string, number>>({});

  const rows = useMemo(() => {
    const avg = dailyConsumption(movements, products, 30);
    const open = new Map<string, number>();
    for (const po of purchases)
      if (['rascunho', 'enviado', 'parcial'].includes(po.status))
        for (const it of po.items) open.set(it.productId, (open.get(it.productId) ?? 0) + Math.max(0, it.qty - it.received));
    return products
      .filter((p) => p.active && !p.isKit)
      .map((p) => {
        const a = avg.get(p.id) ?? 0;
        const lead = p.leadTimeDays || supplierById.get(p.supplierId)?.leadTimeDays || defaultLead;
        const target = Math.ceil(a * (lead + coverage)) + p.minStock;
        const openQty = open.get(p.id) ?? 0;
        const suggest = Math.max(0, target - Math.max(0, p.stock) - openQty);
        const daysLeft = a ? Math.max(0, p.stock) / a : Infinity;
        return { p, avg: a, lead, openQty, suggest, daysLeft, urgent: daysLeft <= lead };
      })
      .filter((r) => r.suggest > 0)
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [products, movements, purchases, supplierById, coverage, defaultLead]);

  useEffect(() => setSelected(Object.fromEntries(rows.map((r) => [r.p.id, r.suggest]))), [rows]);

  async function create() {
    const chosen = rows.filter((r) => (selected[r.p.id] ?? 0) > 0);
    if (!chosen.length) return toast('Selecione itens', 'info');
    const bySupplier = new Map<string, typeof chosen>();
    for (const r of chosen) bySupplier.set(r.p.supplierId, [...(bySupplier.get(r.p.supplierId) ?? []), r]);
    try {
      let n = Number(nextPurchaseNumber().replace(/\D/g, ''));
      for (const [sid, list] of bySupplier) {
        const now = new Date().toISOString();
        await savePurchase({
          id: uid(),
          number: `PC-${n++}`,
          supplierId: sid,
          status: 'rascunho',
          items: list.map((r) => ({ productId: r.p.id, qty: selected[r.p.id], received: 0, unitCost: r.p.cost })),
          expectedAt: '',
          notes: `Gerado pela sugestão de compra (cobertura ${coverage} dias)`,
          invoiceNumber: '',
          invoiceKey: '',
          invoiceDate: '',
          invoiceTotal: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
      toast(`${bySupplier.size} pedido(s) criado(s) como rascunho`);
      onCreated();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  const value = rows.reduce((s, r) => s + (selected[r.p.id] ?? 0) * r.p.cost, 0);

  return (
    <Card>
      <CardTitle hint="Baseado no consumo dos últimos 30 dias, prazo do fornecedor, estoque mínimo e pedidos já em aberto">
        <span className="inline-flex items-center gap-2">
          <Lightbulb size={16} className="text-amber-500" /> O que comprar agora
        </span>
      </CardTitle>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Cobrir quantos dias após a chegada">
          <Input type="number" min={1} className="w-32" value={coverage} onChange={(e) => setCoverage(Math.max(1, Number(e.target.value) || 1))} />
        </Field>
        <Field label="Prazo padrão (dias)" hint="quando o produto/fornecedor não informa">
          <Input type="number" min={0} className="w-32" value={defaultLead} onChange={(e) => setDefaultLead(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        <div className="flex-1" />
        <Button variant="secondary" onClick={() => download(`sugestao-compra-${stamp()}.csv`, toCSV(rows, [
          { label: 'SKU', get: (r) => r.p.sku },
          { label: 'Produto', get: (r) => r.p.name },
          { label: 'Fornecedor', get: (r) => supplierById.get(r.p.supplierId)?.name ?? '' },
          { label: 'Saldo', get: (r) => r.p.stock },
          { label: 'Consumo/dia', get: (r) => +r.avg.toFixed(2) },
          { label: 'Em pedido', get: (r) => r.openQty },
          { label: 'Sugerido', get: (r) => selected[r.p.id] ?? r.suggest },
          { label: 'Custo unit.', get: (r) => r.p.cost },
        ]))}>
          Exportar
        </Button>
        <Button onClick={create} disabled={!rows.length}>
          <Truck size={16} /> Gerar pedidos ({brl(value)})
        </Button>
      </div>
      {rows.length === 0 ? (
        <Empty icon={<CheckCheck size={36} />} title="Nada para comprar agora" text="O estoque + pedidos em aberto cobrem o período escolhido." />
      ) : (
        <div className="-mx-3 overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Fornecedor</th>
                <th className="text-right">Saldo</th>
                <th className="text-right">Consumo/dia</th>
                <th className="text-right">Dura</th>
                <th className="text-right">Em pedido</th>
                <th className="text-right">Comprar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.p.id}>
                  <td className="max-w-60">
                    <div className="truncate">{r.p.name}</div>
                    <div className="text-faint text-xs">{r.p.sku} · prazo {r.lead}d</div>
                  </td>
                  <td className="text-muted">{supplierById.get(r.p.supplierId)?.name ?? <span className="text-faint">sem fornecedor</span>}</td>
                  <td className="text-right tabular-nums">{r.p.stock}</td>
                  <td className="text-right tabular-nums">{num(r.avg, 1)}</td>
                  <td className="text-right">
                    <Badge tone={r.urgent ? 'red' : 'amber'}>{Number.isFinite(r.daysLeft) ? `${num(r.daysLeft)}d` : '—'}</Badge>
                  </td>
                  <td className="text-right tabular-nums">{r.openQty || '—'}</td>
                  <td className="text-right">
                    <input
                      className="h-8 w-20 rounded-lg border border-line bg-surface text-center text-sm tabular-nums"
                      value={selected[r.p.id] ?? 0}
                      inputMode="numeric"
                      onChange={(e) => setSelected((s) => ({ ...s, [r.p.id]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {suppliers.length === 0 && <p className="text-faint mt-3 text-xs">Dica: cadastre fornecedores e vincule aos produtos para gerar um pedido por fornecedor automaticamente.</p>}
    </Card>
  );
}
