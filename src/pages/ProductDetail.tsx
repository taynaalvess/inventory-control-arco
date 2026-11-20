import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, Boxes, Package, Pencil, Printer, Timer, TrendingUp } from 'lucide-react';
import { useStore } from '../lib/store';
import { dailyConsumption } from '../lib/metrics';
import { addDays, brl, dateTime, dayKey, num, pct, shortDay, startOfDay } from '../lib/format';
import { printLabels } from '../lib/labels';
import { MOVEMENT_LABEL, SOURCE_LABEL } from '../lib/types';
import { ProductForm } from '../components/ProductForm';
import { Badge, Button, Card, CardTitle, Empty, Kpi, PageHeader, Segmented } from '../components/ui';

export default function ProductDetail() {
  const { id } = useParams();
  const { productById, products, movements, storeById, supplierById, can, kitAvailable } = useStore();
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState(90);
  const p = id ? productById.get(id) : undefined;
  const finance = can('finance');

  const own = useMemo(
    () => (p ? movements.filter((m) => m.productId === p.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : []),
    [movements, p],
  );

  const kardex = useMemo(() => {
    let bal = 0;
    return own.map((m) => {
      if (m.affectsStock) bal += m.qty;
      return { m, balance: bal };
    });
  }, [own]);

  const series = useMemo(() => {
    const from = startOfDay(addDays(new Date(), -(days - 1)));
    let bal = 0;
    let i = 0;
    const stockMoves = own.filter((m) => m.affectsStock);
    for (; i < stockMoves.length && new Date(stockMoves[i].createdAt) < from; i++) bal += stockMoves[i].qty;
    const out: { date: string; saldo: number }[] = [];
    for (let d = new Date(from); d <= new Date(); d = addDays(d, 1)) {
      const end = addDays(d, 1);
      for (; i < stockMoves.length && new Date(stockMoves[i].createdAt) < end; i++) bal += stockMoves[i].qty;
      out.push({ date: dayKey(d), saldo: bal });
    }
    return out;
  }, [own, days]);

  const byStore = useMemo(() => {
    const since = addDays(new Date(), -days);
    const map = new Map<string, { units: number; revenue: number }>();
    for (const m of own) {
      if (m.type !== 'venda' || new Date(m.createdAt) < since) continue;
      const k = m.storeId ?? '';
      const v = map.get(k) ?? { units: 0, revenue: 0 };
      v.units += Math.abs(m.qty);
      v.revenue += Math.abs(m.qty) * (m.unitPrice ?? p?.price ?? 0);
      map.set(k, v);
    }
    return [...map.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
  }, [own, days, p]);

  if (!p)
    return (
      <Card>
        <Empty icon={<Package size={36} />} title="Produto não encontrado" action={<Link to="/produtos" className="text-brand text-sm">Voltar para produtos</Link>} />
      </Card>
    );

  const avg = dailyConsumption(movements, products, 30).get(p.id) ?? 0;
  const stock = p.isKit ? kitAvailable(p) : p.stock;
  const coverage = avg ? stock / avg : null;
  const usedIn = products.filter((k) => k.isKit && k.kitItems.some((it) => it.productId === p.id));
  const supplier = p.supplierId ? supplierById.get(p.supplierId) : null;

  return (
    <>
      <Link to="/produtos" className="text-muted mb-3 inline-flex items-center gap-1 text-sm hover:underline">
        <ArrowLeft size={14} /> Produtos
      </Link>
      <PageHeader
        title={p.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{p.sku}</span>
            {p.ean && <span className="font-mono">· {p.ean}</span>}
            {p.isKit && <Badge tone="violet">Kit</Badge>}
            {!p.active && <Badge>inativo</Badge>}
            {p.location && <Badge tone="blue">{p.location}</Badge>}
            {supplier && <span>· {supplier.name}</span>}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => printLabels([{ product: p, copies: 1 }])}>
              <Printer size={16} /> Etiqueta
            </Button>
            {can('manage') && (
              <Button onClick={() => setEditing(true)}>
                <Pencil size={16} /> Editar
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi label={p.isKit ? 'Kits montáveis' : 'Saldo atual'} value={num(stock)} hint={p.minStock ? `mínimo ${p.minStock}` : undefined} icon={<Boxes size={16} />} tone={stock <= 0 ? 'red' : p.minStock && stock <= p.minStock ? 'amber' : 'green'} />
        <Kpi label="Consumo médio" value={`${num(avg, 1)}/dia`} hint="últimos 30 dias" icon={<TrendingUp size={16} />} tone="blue" />
        <Kpi label="Cobertura" value={coverage === null ? '—' : `${num(coverage)} dias`} hint={p.leadTimeDays || supplier?.leadTimeDays ? `prazo de entrega ${p.leadTimeDays || supplier?.leadTimeDays} dias` : undefined} icon={<Timer size={16} />} tone="amber" />
        {finance && <Kpi label="Custo · Preço" value={`${brl(p.cost)}`} hint={`venda ${brl(p.price)} · margem ${pct(p.price ? (p.price - p.cost) / p.price : 0)}`} icon={<Package size={16} />} />}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle
            hint="Evolução do saldo"
            action={
              <Segmented
                value={days}
                onChange={setDays}
                options={[
                  { value: 30, label: '30d' },
                  { value: 90, label: '90d' },
                  { value: 365, label: '12m' },
                ]}
              />
            }
          >
            Saldo no tempo
          </CardTitle>
          {p.isKit ? (
            <p className="text-muted py-10 text-center text-sm">Kits não têm saldo próprio — veja os componentes ao lado.</p>
          ) : (
            <div className="h-60">
              <ResponsiveContainer>
                <AreaChart data={series} margin={{ left: 0, right: 8, top: 4 }}>
                  <defs>
                    <linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDay} interval={days <= 30 ? 3 : days <= 90 ? 10 : 30} tickLine={false} axisLine={false} />
                  <YAxis width={40} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip labelFormatter={(l) => shortDay(String(l))} formatter={(v: number) => [num(v), 'Saldo']} />
                  <Area type="stepAfter" dataKey="saldo" stroke="#10b981" strokeWidth={2} fill="url(#s)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          {p.isKit ? (
            <>
              <CardTitle hint="Saldo de cada componente">Componentes do kit</CardTitle>
              <ul className="divide-y divide-line text-sm">
                {p.kitItems.map((it) => {
                  const c = productById.get(it.productId);
                  return (
                    <li key={it.productId} className="flex items-center justify-between gap-2 py-2">
                      <Link to={`/produtos/${it.productId}`} className="truncate hover:underline">
                        {it.qty}× {c?.name ?? '—'}
                      </Link>
                      <Badge tone={(c?.stock ?? 0) < it.qty ? 'red' : 'green'}>{c?.stock ?? 0}</Badge>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : finance ? (
            <>
              <CardTitle hint={`Últimos ${days} dias`}>Vendas por loja</CardTitle>
              {byStore.length ? (
                <ul className="divide-y divide-line text-sm">
                  {byStore.map(([sid, v]) => {
                    const st = storeById.get(sid);
                    return (
                      <li key={sid} className="flex items-center justify-between gap-2 py-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: st?.color ?? '#94a3b8' }} />
                          <span className="truncate">{st?.name ?? 'Sem loja'}</span>
                        </span>
                        <span className="text-muted shrink-0 tabular-nums">
                          {num(v.units)} un · {brl(v.revenue)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-muted text-sm">Sem vendas no período.</p>
              )}
            </>
          ) : (
            <CardTitle>Informações</CardTitle>
          )}
          {usedIn.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-muted mb-2 text-xs font-medium">Faz parte dos kits</p>
              <ul className="space-y-1 text-sm">
                {usedIn.map((k) => (
                  <li key={k.id}>
                    <Link to={`/produtos/${k.id}`} className="hover:underline">
                      {k.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4 p-0 sm:p-0">
        <div className="p-4 sm:p-5">
          <CardTitle hint={`${own.length} movimentações — saldo calculado linha a linha`}>Kardex (histórico)</CardTitle>
        </div>
        {kardex.length === 0 ? (
          <Empty title="Sem movimentações" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th className="text-right">Qtd.</th>
                  <th className="text-right">Saldo</th>
                  {finance && <th className="text-right">Valor unit.</th>}
                  <th>Loja</th>
                  <th>Ref.</th>
                  <th>Origem</th>
                  <th>Obs.</th>
                </tr>
              </thead>
              <tbody>
                {[...kardex].reverse().slice(0, 500).map(({ m, balance }) => (
                  <tr key={m.id}>
                    <td className="text-muted whitespace-nowrap">{dateTime(m.createdAt)}</td>
                    <td>
                      <Badge>{MOVEMENT_LABEL[m.type]}</Badge>
                      {!m.affectsStock && <Badge className="ml-1">só métrica</Badge>}
                    </td>
                    <td className={`text-right font-medium tabular-nums ${m.qty > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {m.qty > 0 ? '+' : ''}
                      {m.qty}
                    </td>
                    <td className="text-right tabular-nums">{p.isKit ? '—' : balance}</td>
                    {finance && <td className="text-right tabular-nums">{m.unitPrice !== null ? brl(m.unitPrice) : m.unitCost !== null ? brl(m.unitCost) : '—'}</td>}
                    <td className="whitespace-nowrap">{m.storeId ? storeById.get(m.storeId)?.name ?? '—' : '—'}</td>
                    <td className="text-muted font-mono text-xs">{m.ref || '—'}</td>
                    <td className="text-muted text-xs">{SOURCE_LABEL[m.source]}</td>
                    <td className="text-muted max-w-56 truncate text-xs">{m.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ProductForm open={editing} product={p} onClose={() => setEditing(false)} />
    </>
  );
}
