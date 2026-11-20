import { addDays, dayKey, startOfDay } from './format';
import type { Movement, Product, Store } from './types';

export interface StoreStat {
  storeId: string;
  name: string;
  color: string;
  channel: string;
  revenue: number;
  units: number;
  orders: number;
  ticket: number;
  share: number;
  margin: number;
  topProduct: Product | null;
}

export interface ProductStat {
  product: Product;
  units: number;
  revenue: number;
  abc: 'A' | 'B' | 'C';
}

export interface CoverageStat {
  product: Product;
  avgDaily: number;
  days: number;
}

export interface Metrics {
  from: Date;
  revenue: number;
  prevRevenue: number;
  units: number;
  prevUnits: number;
  orders: number;
  ticket: number;
  grossMargin: number;
  stockValue: number;
  retailValue: number;
  totalUnits: number;
  activeSkus: number;
  lowStock: Product[];
  outOfStock: Product[];
  daily: Array<{ date: string; revenue: number; units: number } & Record<string, number | string>>;
  byStore: StoreStat[];
  topProducts: ProductStat[];
  abcCount: { A: number; B: number; C: number };
  coverage: CoverageStat[];
  deadStock: Product[];
  entries: number;
  exits: number;
}

const NO_STORE = '__sem_loja__';

export function computeMetrics(
  products: Product[],
  stores: Store[],
  movements: Movement[],
  opts: { days: number; storeId?: string | null },
): Metrics {
  const now = new Date();
  const from = startOfDay(addDays(now, -(opts.days - 1)));
  const prevFrom = addDays(from, -opts.days);
  const last30 = startOfDay(addDays(now, -29));
  const dead60 = addDays(now, -60);
  const pmap = new Map(products.map((p) => [p.id, p]));
  const smap = new Map(stores.map((s) => [s.id, s]));

  let revenue = 0,
    prevRevenue = 0,
    units = 0,
    prevUnits = 0,
    cogs = 0,
    entries = 0,
    exits = 0;
  const orders = new Set<string>();

  const daily = new Map<string, { date: string; revenue: number; units: number } & Record<string, number | string>>();
  for (let d = new Date(from); d <= now; d = addDays(d, 1)) {
    const k = dayKey(d);
    daily.set(k, { date: k, revenue: 0, units: 0 });
  }

  const storeAgg = new Map<string, { revenue: number; units: number; cogs: number; orders: Set<string>; prod: Map<string, number> }>();
  const prodAgg = new Map<string, { units: number; revenue: number }>();
  const sold30 = new Map<string, number>();
  const lastSale = new Map<string, number>();

  for (const m of movements) {
    const t = new Date(m.createdAt);
    const time = t.getTime();
    const isSale = m.type === 'venda' || m.type === 'devolucao';

    if (m.type === 'venda') {
      if (time > (lastSale.get(m.productId) ?? 0)) lastSale.set(m.productId, time);
      if (t >= last30) sold30.set(m.productId, (sold30.get(m.productId) ?? 0) + Math.abs(m.qty));
    }

    if (opts.storeId && m.storeId !== opts.storeId) continue;

    if (!isSale) {
      if (t >= from && m.affectsStock) {
        if (m.qty > 0) entries += m.qty;
        else exits += -m.qty;
      }
      continue;
    }

    const p = pmap.get(m.productId);
    const sign = m.type === 'venda' ? 1 : -1;
    const u = Math.abs(m.qty) * sign;
    const rev = u * (m.unitPrice ?? p?.price ?? 0);
    const cost = u * (m.unitCost ?? p?.cost ?? 0);

    if (t >= from) {
      revenue += rev;
      units += u;
      cogs += cost;
      const sid = m.storeId ?? NO_STORE;
      if (m.type === 'venda') orders.add(`${sid}|${m.ref || m.id}`);

      const day = daily.get(dayKey(t));
      if (day) {
        day.revenue += rev;
        day.units += u;
        day[sid] = ((day[sid] as number) ?? 0) + rev;
      }

      let sa = storeAgg.get(sid);
      if (!sa) storeAgg.set(sid, (sa = { revenue: 0, units: 0, cogs: 0, orders: new Set(), prod: new Map() }));
      sa.revenue += rev;
      sa.units += u;
      sa.cogs += cost;
      if (m.type === 'venda') sa.orders.add(m.ref || m.id);
      sa.prod.set(m.productId, (sa.prod.get(m.productId) ?? 0) + rev);

      const pa = prodAgg.get(m.productId) ?? { units: 0, revenue: 0 };
      pa.units += u;
      pa.revenue += rev;
      prodAgg.set(m.productId, pa);
    } else if (t >= prevFrom) {
      prevRevenue += rev;
      prevUnits += u;
    }
  }

  // ----- estoque (independe do filtro de loja)
  const active = products.filter((p) => p.active);
  let stockValue = 0,
    retailValue = 0,
    totalUnits = 0;
  for (const p of active) {
    const q = Math.max(0, p.stock);
    stockValue += q * p.cost;
    retailValue += q * p.price;
    totalUnits += q;
  }
  const outOfStock = active.filter((p) => p.stock <= 0);
  const lowStock = active
    .filter((p) => p.stock > 0 && p.minStock > 0 && p.stock <= p.minStock)
    .sort((a, b) => a.stock / (a.minStock || 1) - b.stock / (b.minStock || 1));

  // ----- curva ABC (por faturamento no período)
  const ranked = [...prodAgg.entries()]
    .filter(([id]) => pmap.has(id))
    .map(([id, v]) => ({ product: pmap.get(id)!, ...v }))
    .sort((a, b) => b.revenue - a.revenue);
  const total = ranked.reduce((s, r) => s + Math.max(0, r.revenue), 0) || 1;
  let acc = 0;
  const abcCount = { A: 0, B: 0, C: 0 };
  const topProducts: ProductStat[] = ranked.map((r) => {
    acc += Math.max(0, r.revenue);
    const share = acc / total;
    const abc: 'A' | 'B' | 'C' = share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C';
    abcCount[abc]++;
    return { ...r, abc };
  });
  abcCount.C += active.length - ranked.length;

  // ----- cobertura: quantos dias o estoque dura no ritmo dos últimos 30 dias
  const coverage: CoverageStat[] = active
    .filter((p) => (sold30.get(p.id) ?? 0) > 0)
    .map((p) => {
      const avgDaily = (sold30.get(p.id) ?? 0) / 30;
      return { product: p, avgDaily, days: Math.max(0, p.stock) / avgDaily };
    })
    .sort((a, b) => a.days - b.days);

  // ----- estoque parado: com saldo e sem venda há 60 dias
  const deadStock = active
    .filter((p) => p.stock > 0 && (lastSale.get(p.id) ?? 0) < dead60.getTime() && new Date(p.createdAt) < dead60)
    .sort((a, b) => b.stock * b.cost - a.stock * a.cost);

  const byStore: StoreStat[] = [...storeAgg.entries()]
    .map(([sid, v]) => {
      const st = smap.get(sid);
      const topId = [...v.prod.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      return {
        storeId: sid,
        name: st?.name ?? 'Sem loja',
        color: st?.color ?? '#94a3b8',
        channel: st?.channel ?? '',
        revenue: v.revenue,
        units: v.units,
        orders: v.orders.size,
        ticket: v.orders.size ? v.revenue / v.orders.size : 0,
        share: revenue ? v.revenue / revenue : 0,
        margin: v.revenue ? (v.revenue - v.cogs) / v.revenue : 0,
        topProduct: topId ? pmap.get(topId) ?? null : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  return {
    from,
    revenue,
    prevRevenue,
    units,
    prevUnits,
    orders: orders.size,
    ticket: orders.size ? revenue / orders.size : 0,
    grossMargin: revenue ? (revenue - cogs) / revenue : 0,
    stockValue,
    retailValue,
    totalUnits,
    activeSkus: active.length,
    lowStock,
    outOfStock,
    daily: [...daily.values()],
    byStore,
    topProducts,
    abcCount,
    coverage,
    deadStock,
    entries,
    exits,
  };
}

export const NO_STORE_KEY = NO_STORE;

export function delta(cur: number, prev: number) {
  if (!prev) return null;
  return (cur - prev) / Math.abs(prev);
}
