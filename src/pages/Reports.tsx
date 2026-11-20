import { useMemo, useState } from 'react';
import { Download, FileBarChart } from 'lucide-react';
import { useStore } from '../lib/store';
import { computeMetrics, dailyConsumption } from '../lib/metrics';
import { addDays, brl, dateTime, num, pct, startOfDay } from '../lib/format';
import { download, stamp, toCSV } from '../lib/files';
import { Card, Empty, PageHeader, Segmented, Select, cx } from '../components/ui';
import { Button } from '../components/ui';

type Fmt = 'brl' | 'num' | 'pct' | 'text' | 'dec';
interface Col<T> {
  label: string;
  get: (r: T) => string | number;
  fmt?: Fmt;
}
interface Report<T = any> {
  key: string;
  title: string;
  desc: string;
  columns: Col<T>[];
  rows: T[];
}

const show = (v: string | number, f: Fmt = 'text') =>
  typeof v !== 'number' ? v : f === 'brl' ? brl(v) : f === 'pct' ? pct(v) : f === 'dec' ? num(v, 2) : f === 'num' ? num(v) : String(v);

export default function Reports() {
  const { products, stores, movements, purchases, productById, storeById, supplierById } = useStore();
  const [days, setDays] = useState(30);
  const [key, setKey] = useState('posicao');

  const reports = useMemo<Report[]>(() => {
    const m = computeMetrics(products, stores, movements, { days });
    const from = startOfDay(addDays(new Date(), -(days - 1)));
    const inPeriod = movements.filter((x) => new Date(x.createdAt) >= from);
    const real = products.filter((p) => !p.isKit);
    const avg = dailyConsumption(movements, products, days);

    const sales = new Map<string, { productId: string; storeId: string; units: number; revenue: number }>();
    for (const x of inPeriod) {
      if (x.type !== 'venda') continue;
      const k = `${x.productId}|${x.storeId ?? ''}`;
      const v = sales.get(k) ?? { productId: x.productId, storeId: x.storeId ?? '', units: 0, revenue: 0 };
      v.units += Math.abs(x.qty);
      v.revenue += Math.abs(x.qty) * (x.unitPrice ?? productById.get(x.productId)?.price ?? 0);
      sales.set(k, v);
    }
    const soldUnits = new Map<string, number>();
    for (const v of sales.values()) soldUnits.set(v.productId, (soldUnits.get(v.productId) ?? 0) + v.units);

    return [
      {
        key: 'posicao',
        title: 'Posição de estoque',
        desc: 'Saldo atual e valor do estoque por produto',
        rows: real.filter((p) => p.active).sort((a, b) => b.stock * b.cost - a.stock * a.cost),
        columns: [
          { label: 'SKU', get: (p) => p.sku },
          { label: 'Produto', get: (p) => p.name },
          { label: 'Categoria', get: (p) => p.category },
          { label: 'Local', get: (p) => p.location },
          { label: 'Fornecedor', get: (p) => supplierById.get(p.supplierId)?.name ?? '' },
          { label: 'Saldo', get: (p) => p.stock, fmt: 'num' },
          { label: 'Mínimo', get: (p) => p.minStock, fmt: 'num' },
          { label: 'Custo médio', get: (p) => p.cost, fmt: 'brl' },
          { label: 'Valor (custo)', get: (p) => Math.max(0, p.stock) * p.cost, fmt: 'brl' },
          { label: 'Valor (venda)', get: (p) => Math.max(0, p.stock) * p.price, fmt: 'brl' },
        ],
      },
      {
        key: 'lojas',
        title: 'Lucro por loja',
        desc: 'Faturamento, custo das mercadorias, taxas do marketplace e lucro líquido',
        rows: m.byStore,
        columns: [
          { label: 'Loja', get: (s) => s.name },
          { label: 'Canal', get: (s) => s.channel },
          { label: 'Pedidos', get: (s) => s.orders, fmt: 'num' },
          { label: 'Unidades', get: (s) => s.units, fmt: 'num' },
          { label: 'Faturamento', get: (s) => s.revenue, fmt: 'brl' },
          { label: 'Ticket médio', get: (s) => s.ticket, fmt: 'brl' },
          { label: 'Custo mercadoria', get: (s) => s.revenue * (1 - s.margin), fmt: 'brl' },
          { label: 'Taxas', get: (s) => s.fees, fmt: 'brl' },
          { label: 'Lucro líquido', get: (s) => s.netProfit, fmt: 'brl' },
          { label: 'Margem líquida', get: (s) => s.netMargin, fmt: 'pct' },
        ],
      },
      {
        key: 'abc',
        title: 'Curva ABC',
        desc: 'Produtos classificados por participação no faturamento (A = 80%, B = 15%, C = 5%)',
        rows: m.topProducts,
        columns: [
          { label: 'Classe', get: (r) => r.abc },
          { label: 'SKU', get: (r) => r.product.sku },
          { label: 'Produto', get: (r) => r.product.name },
          { label: 'Unidades', get: (r) => r.units, fmt: 'num' },
          { label: 'Faturamento', get: (r) => r.revenue, fmt: 'brl' },
          { label: 'Participação', get: (r) => (m.revenue ? r.revenue / m.revenue : 0), fmt: 'pct' },
        ],
      },
      {
        key: 'produto-loja',
        title: 'Vendas por produto e loja',
        desc: 'Unidades e faturamento de cada produto em cada canal',
        rows: [...sales.values()].sort((a, b) => b.revenue - a.revenue),
        columns: [
          { label: 'SKU', get: (r) => productById.get(r.productId)?.sku ?? '' },
          { label: 'Produto', get: (r) => productById.get(r.productId)?.name ?? '' },
          { label: 'Loja', get: (r) => storeById.get(r.storeId)?.name ?? 'Sem loja' },
          { label: 'Unidades', get: (r) => r.units, fmt: 'num' },
          { label: 'Faturamento', get: (r) => r.revenue, fmt: 'brl' },
          { label: 'Preço médio', get: (r) => (r.units ? r.revenue / r.units : 0), fmt: 'brl' },
        ],
      },
      {
        key: 'giro',
        title: 'Giro e cobertura',
        desc: 'Velocidade de venda e quantos dias o estoque atual dura',
        rows: real
          .filter((p) => p.active)
          .map((p) => ({ p, sold: soldUnits.get(p.id) ?? 0, avg: avg.get(p.id) ?? 0 }))
          .sort((a, b) => b.avg - a.avg),
        columns: [
          { label: 'SKU', get: (r) => r.p.sku },
          { label: 'Produto', get: (r) => r.p.name },
          { label: 'Saldo', get: (r) => r.p.stock, fmt: 'num' },
          { label: `Vendido (${days}d)`, get: (r) => r.sold, fmt: 'num' },
          { label: 'Consumo/dia', get: (r) => r.avg, fmt: 'dec' },
          { label: 'Cobertura (dias)', get: (r) => (r.avg ? Math.round(Math.max(0, r.p.stock) / r.avg) : '—'), fmt: 'num' },
          { label: 'Giro no período', get: (r) => (r.p.stock > 0 ? r.sold / r.p.stock : r.sold ? r.sold : 0), fmt: 'dec' },
        ],
      },
      {
        key: 'parado',
        title: 'Estoque parado',
        desc: 'Produtos com saldo e sem venda há mais de 60 dias — capital imobilizado',
        rows: m.deadStock,
        columns: [
          { label: 'SKU', get: (p) => p.sku },
          { label: 'Produto', get: (p) => p.name },
          { label: 'Saldo', get: (p) => p.stock, fmt: 'num' },
          { label: 'Valor parado', get: (p) => p.stock * p.cost, fmt: 'brl' },
        ],
      },
      {
        key: 'ajustes',
        title: 'Ajustes e divergências',
        desc: 'Ajustes de inventário, perdas e correções no período',
        rows: inPeriod.filter((x) => x.type === 'ajuste').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        columns: [
          { label: 'Data', get: (x) => dateTime(x.createdAt) },
          { label: 'SKU', get: (x) => productById.get(x.productId)?.sku ?? '' },
          { label: 'Produto', get: (x) => productById.get(x.productId)?.name ?? '' },
          { label: 'Diferença', get: (x) => x.qty, fmt: 'num' },
          { label: 'Impacto (custo)', get: (x) => x.qty * (x.unitCost ?? productById.get(x.productId)?.cost ?? 0), fmt: 'brl' },
          { label: 'Motivo', get: (x) => x.note },
        ],
      },
      {
        key: 'compras',
        title: 'Compras recebidas',
        desc: 'Entradas vindas de pedidos de compra no período',
        rows: inPeriod.filter((x) => x.source === 'compra').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        columns: [
          { label: 'Data', get: (x) => dateTime(x.createdAt) },
          { label: 'Pedido', get: (x) => x.ref },
          { label: 'Fornecedor', get: (x) => supplierById.get(purchases.find((p) => p.number === x.ref)?.supplierId ?? '')?.name ?? '' },
          { label: 'Produto', get: (x) => productById.get(x.productId)?.name ?? '' },
          { label: 'Qtd.', get: (x) => x.qty, fmt: 'num' },
          { label: 'Custo unit.', get: (x) => x.unitCost ?? 0, fmt: 'brl' },
          { label: 'Total', get: (x) => x.qty * (x.unitCost ?? 0), fmt: 'brl' },
        ],
      },
    ];
  }, [products, stores, movements, purchases, days, productById, storeById, supplierById]);

  const r = reports.find((x) => x.key === key)!;
  const numeric = r.columns.map((c) => c.fmt && c.fmt !== 'text');

  function exportCsv() {
    download(
      `${r.key}-${stamp()}.csv`,
      toCSV(r.rows, r.columns.map((c) => ({ label: c.label, get: (row) => (typeof c.get(row) === 'number' ? +(c.get(row) as number).toFixed(4) : c.get(row)) }))),
    );
  }

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle="Escolha o relatório, o período e exporte para Excel"
        actions={
          <Segmented
            value={days}
            onChange={setDays}
            options={[
              { value: 7, label: '7d' },
              { value: 30, label: '30d' },
              { value: 90, label: '90d' },
              { value: 365, label: '12m' },
            ]}
          />
        }
      />
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="h-fit p-2 sm:p-2">
          <div className="lg:hidden">
            <Select value={key} onChange={(e) => setKey(e.target.value)}>
              {reports.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.title}
                </option>
              ))}
            </Select>
          </div>
          <nav className="hidden flex-col gap-1 lg:flex">
            {reports.map((x) => (
              <button
                key={x.key}
                onClick={() => setKey(x.key)}
                className={cx('rounded-xl px-3 py-2.5 text-left text-sm transition', key === x.key ? 'bg-brand/10 text-brand font-medium dark:text-indigo-300' : 'text-muted hover:bg-hover')}
              >
                {x.title}
                <span className="text-faint block text-xs">{x.rows.length} linhas</span>
              </button>
            ))}
          </nav>
        </Card>

        <Card className="p-0 sm:p-0 lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
            <div>
              <h3 className="font-semibold">{r.title}</h3>
              <p className="text-muted text-xs">{r.desc}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!r.rows.length}>
              <Download size={14} /> Exportar CSV
            </Button>
          </div>
          {r.rows.length === 0 ? (
            <Empty icon={<FileBarChart size={36} />} title="Sem dados para o período" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    {r.columns.map((c, i) => (
                      <th key={c.label} className={numeric[i] ? 'text-right' : ''}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.rows.slice(0, 300).map((row, ri) => (
                    <tr key={ri}>
                      {r.columns.map((c, i) => (
                        <td key={c.label} className={cx(numeric[i] ? 'text-right tabular-nums' : 'max-w-64 truncate', 'whitespace-nowrap')}>
                          {show(c.get(row), c.fmt)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.rows.length > 300 && <p className="text-muted p-3 text-center text-xs">Mostrando 300 de {r.rows.length}. A exportação inclui todas as linhas.</p>}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
