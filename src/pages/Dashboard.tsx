import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Boxes, DollarSign, Package, PackageX, Percent, Receipt, ShoppingCart, Sparkles, Timer } from 'lucide-react';
import { useStore } from '../lib/store';
import { computeMetrics, delta, NO_STORE_KEY } from '../lib/metrics';
import { brl, compactBrl, num, pct, shortDay } from '../lib/format';
import { Badge, Card, CardTitle, Empty, Kpi, PageHeader, Segmented, Select, StockBadge } from '../components/ui';

const PERIODS = [
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
  { value: 90, label: '90 dias' },
  { value: 365, label: '12 meses' },
];

export default function Dashboard() {
  const { products, stores, movements } = useStore();
  const [days, setDays] = useState(30);
  const [storeId, setStoreId] = useState('');
  const m = useMemo(() => computeMetrics(products, stores, movements, { days, storeId: storeId || null }), [products, stores, movements, days, storeId]);

  if (!products.length)
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card>
          <Empty
            icon={<Sparkles size={36} />}
            title="Bem-vinda ao Arco Estoque"
            text="Cadastre produtos, importe a planilha do UpSeller ou carregue dados de demonstração para ver o painel funcionando."
            action={
              <>
                <Link to="/integracoes" className="bg-brand inline-flex h-10 items-center rounded-xl px-4 text-sm font-medium text-white">
                  Importar do UpSeller
                </Link>
                <Link to="/produtos" className="inline-flex h-10 items-center rounded-xl border border-line px-4 text-sm font-medium hover:bg-hover">
                  Cadastrar produto
                </Link>
                <Link to="/configuracoes" className="inline-flex h-10 items-center rounded-xl border border-line px-4 text-sm font-medium hover:bg-hover">
                  Dados de demonstração
                </Link>
              </>
            }
          />
        </Card>
      </>
    );

  const storeKeys = m.byStore.map((s) => ({ key: s.storeId === NO_STORE_KEY ? NO_STORE_KEY : s.storeId, name: s.name, color: s.color }));
  const interval = days <= 7 ? 0 : days <= 30 ? 3 : days <= 90 ? 10 : 30;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Desde ${m.from.toLocaleDateString('pt-BR')}`}
        actions={
          <>
            <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="h-9 w-auto min-w-40">
              <option value="">Todas as lojas</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Segmented value={days} onChange={setDays} options={PERIODS} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi label="Faturamento" value={compactBrl(m.revenue)} change={delta(m.revenue, m.prevRevenue)} hint="vs. período anterior" icon={<DollarSign size={16} />} />
        <Kpi label="Pedidos" value={num(m.orders)} hint={`${num(m.units)} unidades`} change={delta(m.units, m.prevUnits)} icon={<ShoppingCart size={16} />} tone="blue" />
        <Kpi label="Ticket médio" value={brl(m.ticket)} icon={<Receipt size={16} />} tone="green" />
        <Kpi label="Margem bruta" value={pct(m.grossMargin)} hint="preço − custo" icon={<Percent size={16} />} tone="amber" />
        <Kpi label="Valor em estoque (custo)" value={compactBrl(m.stockValue)} hint={`${compactBrl(m.retailValue)} a preço de venda`} icon={<Boxes size={16} />} />
        <Kpi label="Unidades em estoque" value={num(m.totalUnits)} hint={`${m.activeSkus} SKUs ativos`} icon={<Package size={16} />} tone="blue" />
        <Kpi label="Abaixo do mínimo" value={m.lowStock.length} hint="precisam de reposição" icon={<AlertTriangle size={16} />} tone="amber" />
        <Kpi label="Sem estoque" value={m.outOfStock.length} hint="ruptura" icon={<PackageX size={16} />} tone="red" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle hint="Faturamento diário por loja">Vendas no período</CardTitle>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={m.daily} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDay} interval={interval} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => compactBrl(v)} width={64} tickLine={false} axisLine={false} />
                <Tooltip labelFormatter={(l) => shortDay(String(l))} formatter={(v: number, name: string) => [brl(v), storeKeys.find((s) => s.key === name)?.name ?? name]} cursor={{ fill: 'var(--hover)' }} />
                {storeKeys.map((s, i) => (
                  <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} radius={i === storeKeys.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={28} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardTitle hint="Participação no faturamento">Lojas</CardTitle>
          {m.byStore.length ? (
            <>
              <div className="h-44">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={m.byStore} dataKey="revenue" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={2} stroke="none">
                      {m.byStore.map((s) => (
                        <Cell key={s.storeId} fill={s.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => brl(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-2 text-sm">
                {m.byStore.map((s) => (
                  <li key={s.storeId} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                      <span className="truncate">{s.name}</span>
                    </span>
                    <span className="text-muted shrink-0 tabular-nums">
                      {compactBrl(s.revenue)} · {pct(s.share)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty title="Sem vendas no período" />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint="Tendência de unidades vendidas">Unidades por dia</CardTitle>
          <div className="h-56">
            <ResponsiveContainer>
              <AreaChart data={m.daily} margin={{ left: 0, right: 8, top: 4 }}>
                <defs>
                  <linearGradient id="u" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDay} interval={interval} tickLine={false} axisLine={false} />
                <YAxis width={40} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip labelFormatter={(l) => shortDay(String(l))} formatter={(v: number) => [num(v), 'Unidades']} />
                <Area type="monotone" dataKey="units" stroke="#4f46e5" strokeWidth={2} fill="url(#u)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardTitle hint={`Curva ABC — A: ${m.abcCount.A} · B: ${m.abcCount.B} · C: ${m.abcCount.C} SKUs`}>Mais vendidos</CardTitle>
          {m.topProducts.length ? (
            <div className="-mx-3 overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="text-right">Un.</th>
                    <th className="text-right">Faturamento</th>
                    <th>ABC</th>
                  </tr>
                </thead>
                <tbody>
                  {m.topProducts.slice(0, 7).map((t) => (
                    <tr key={t.product.id}>
                      <td className="max-w-56 truncate">{t.product.name}</td>
                      <td className="text-right tabular-nums">{num(t.units)}</td>
                      <td className="text-right tabular-nums">{brl(t.revenue)}</td>
                      <td>
                        <Badge tone={t.abc === 'A' ? 'green' : t.abc === 'B' ? 'blue' : 'neutral'}>{t.abc}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Sem vendas no período" />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle hint="Saldo ≤ estoque mínimo ou zerado" action={<Link to="/produtos?f=baixo" className="text-brand text-xs font-medium">ver todos</Link>}>
            Reposição
          </CardTitle>
          <AlertList items={[...m.outOfStock, ...m.lowStock].slice(0, 8).map((p) => ({ id: p.id, name: p.name, right: <StockBadge stock={p.stock} min={p.minStock} />, sub: `mín. ${p.minStock} · ${p.sku}` }))} empty="Tudo abastecido 🎉" />
        </Card>
        <Card>
          <CardTitle hint="Dias até zerar no ritmo dos últimos 30 dias">
            <span className="inline-flex items-center gap-1.5">
              <Timer size={14} /> Cobertura de estoque
            </span>
          </CardTitle>
          <AlertList
            items={m.coverage.slice(0, 8).map((c) => ({
              id: c.product.id,
              name: c.product.name,
              sub: `${num(c.avgDaily, 1)} un/dia · saldo ${c.product.stock}`,
              right: <Badge tone={c.days < 7 ? 'red' : c.days < 20 ? 'amber' : 'green'}>{c.days >= 999 ? '999+' : num(c.days)} dias</Badge>,
            }))}
            empty="Sem vendas recentes"
          />
        </Card>
        <Card>
          <CardTitle hint="Com saldo e sem venda há 60+ dias">Estoque parado</CardTitle>
          <AlertList
            items={m.deadStock.slice(0, 8).map((p) => ({ id: p.id, name: p.name, sub: `${p.stock} un · ${p.sku}`, right: <span className="text-muted text-xs tabular-nums">{brl(p.stock * p.cost)}</span> }))}
            empty="Nenhum produto parado"
          />
        </Card>
      </div>

      {m.byStore.length > 0 && (
        <Card className="mt-4">
          <CardTitle hint="Comparativo do período" action={<Link to="/lojas" className="text-brand text-xs font-medium">detalhes</Link>}>
            Desempenho por loja
          </CardTitle>
          <div className="-mx-3 overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Loja</th>
                  <th className="text-right">Faturamento</th>
                  <th className="text-right">Pedidos</th>
                  <th className="text-right">Unidades</th>
                  <th className="text-right">Ticket médio</th>
                  <th className="text-right">Margem</th>
                  <th>Mais vendido</th>
                </tr>
              </thead>
              <tbody>
                {m.byStore.map((s) => (
                  <tr key={s.storeId}>
                    <td>
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                        {s.name}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">{brl(s.revenue)}</td>
                    <td className="text-right tabular-nums">{num(s.orders)}</td>
                    <td className="text-right tabular-nums">{num(s.units)}</td>
                    <td className="text-right tabular-nums">{brl(s.ticket)}</td>
                    <td className="text-right tabular-nums">{pct(s.margin)}</td>
                    <td className="max-w-48 truncate">{s.topProduct?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function AlertList({ items, empty }: { items: { id: string; name: string; sub: string; right: React.ReactNode }[]; empty: string }) {
  if (!items.length) return <p className="text-muted py-6 text-center text-sm">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((i) => (
        <li key={i.id} className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm">{i.name}</div>
            <div className="text-faint text-xs">{i.sub}</div>
          </div>
          {i.right}
        </li>
      ))}
    </ul>
  );
}
