import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Movement, Product, Store } from '../types';
import type { DataSource } from './source';

let cached: { url: string; key: string; client: SupabaseClient } | null = null;

export function getSupabase(url: string, key: string) {
  if (!cached || cached.url !== url || cached.key !== key) {
    cached = { url, key, client: createClient(url, key, { auth: { persistSession: true, storageKey: 'arco.auth' } }) };
  }
  return cached.client;
}

/* ---------- mapeamento camelCase <-> snake_case ---------- */
type Row = Record<string, unknown>;
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const productFromRow = (r: Row): Product => ({
  id: s(r.id),
  sku: s(r.sku),
  ean: s(r.ean),
  name: s(r.name),
  category: s(r.category),
  brand: s(r.brand),
  cost: n(r.cost),
  price: n(r.price),
  minStock: n(r.min_stock),
  location: s(r.location),
  stock: n(r.stock),
  imageUrl: s(r.image_url),
  active: r.active !== false,
  upsellerId: s(r.upseller_id),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

/** Sem a coluna stock: o saldo é mantido exclusivamente pelo trigger das movimentações. */
const productToRow = (p: Product): Row => ({
  id: p.id,
  sku: p.sku,
  ean: p.ean || null,
  name: p.name,
  category: p.category,
  brand: p.brand,
  cost: p.cost,
  price: p.price,
  min_stock: p.minStock,
  location: p.location,
  image_url: p.imageUrl,
  active: p.active,
  upseller_id: p.upsellerId || null,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
});

const storeFromRow = (r: Row): Store => ({
  id: s(r.id),
  name: s(r.name),
  channel: s(r.channel),
  color: s(r.color) || '#6366f1',
  active: r.active !== false,
  createdAt: s(r.created_at),
});

const storeToRow = (x: Store): Row => ({
  id: x.id,
  name: x.name,
  channel: x.channel,
  color: x.color,
  active: x.active,
  created_at: x.createdAt,
});

const movementFromRow = (r: Row): Movement => ({
  id: s(r.id),
  productId: s(r.product_id),
  type: s(r.type) as Movement['type'],
  qty: n(r.qty),
  unitPrice: nn(r.unit_price),
  unitCost: nn(r.unit_cost),
  storeId: r.store_id ? s(r.store_id) : null,
  ref: s(r.ref),
  note: s(r.note),
  source: (s(r.source) || 'manual') as Movement['source'],
  affectsStock: r.affects_stock !== false,
  createdAt: s(r.created_at),
});

const movementToRow = (m: Movement): Row => ({
  id: m.id,
  product_id: m.productId,
  type: m.type,
  qty: m.qty,
  unit_price: m.unitPrice,
  unit_cost: m.unitCost,
  store_id: m.storeId,
  ref: m.ref,
  note: m.note,
  source: m.source,
  affects_stock: m.affectsStock,
  created_at: m.createdAt,
});

/* ---------- helpers ---------- */
const PAGE = 1000;

async function fetchAll(sb: SupabaseClient, table: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select('*').order('created_at').order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function chunked<T>(items: T[], size: number, fn: (part: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

function check(error: { message: string } | null, ctx: string) {
  if (error) throw new Error(`${ctx}: ${error.message}`);
}

export function createSupabaseSource(sb: SupabaseClient): DataSource {
  return {
    kind: 'supabase',

    async load() {
      const [p, st, m] = await Promise.all([
        fetchAll(sb, 'products'),
        fetchAll(sb, 'stores'),
        fetchAll(sb, 'movements'),
      ]);
      return { products: p.map(productFromRow), stores: st.map(storeFromRow), movements: m.map(movementFromRow) };
    },

    async upsertProducts(ps) {
      await chunked(ps, 500, async (part) => {
        const { error } = await sb.from('products').upsert(part.map(productToRow), { onConflict: 'id' });
        check(error, 'Salvar produtos');
      });
    },

    async deleteProduct(id) {
      const { error } = await sb.from('products').delete().eq('id', id);
      check(error, 'Excluir produto');
    },

    async upsertStores(ss) {
      const { error } = await sb.from('stores').upsert(ss.map(storeToRow), { onConflict: 'id' });
      check(error, 'Salvar lojas');
    },

    async deleteStore(id) {
      const { error } = await sb.from('stores').delete().eq('id', id);
      check(error, 'Excluir loja');
    },

    async addMovements(ms) {
      await chunked(ms, 500, async (part) => {
        const { error } = await sb.from('movements').insert(part.map(movementToRow));
        check(error, 'Registrar movimentações');
      });
    },

    async replaceAll(d) {
      const ZERO = '00000000-0000-0000-0000-000000000000';
      check((await sb.from('movements').delete().neq('id', ZERO)).error, 'Limpar movimentações');
      check((await sb.from('products').delete().neq('id', ZERO)).error, 'Limpar produtos');
      check((await sb.from('stores').delete().neq('id', ZERO)).error, 'Limpar lojas');
      if (d.stores.length) check((await sb.from('stores').insert(d.stores.map(storeToRow))).error, 'Restaurar lojas');
      await chunked(d.products, 500, async (part) => {
        check((await sb.from('products').insert(part.map(productToRow))).error, 'Restaurar produtos');
      });
      // o trigger recompõe o saldo a partir das movimentações
      await chunked(d.movements, 500, async (part) => {
        check((await sb.from('movements').insert(part.map(movementToRow))).error, 'Restaurar movimentações');
      });
    },
  };
}

export interface SyncRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  message: string;
}

export async function fetchSyncRuns(sb: SupabaseClient): Promise<SyncRun[]> {
  const { data, error } = await sb.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(10);
  if (error) return [];
  return (data as Row[]).map((r) => ({
    id: s(r.id),
    startedAt: s(r.started_at),
    finishedAt: r.finished_at ? s(r.finished_at) : null,
    status: s(r.status),
    message: s(r.message),
  }));
}
