import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { KitItem, Movement, Product, Profile, Purchase, PurchaseItem, Role, SecuritySettings, Store, Supplier } from '../types';
import type { DataSource } from './source';

let cached: { url: string; key: string; client: SupabaseClient } | null = null;

export function getSupabase(url: string, key: string) {
  if (!cached || cached.url !== url || cached.key !== key) {
    cached = {
      url,
      key,
      client: createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          // PKCE: links de e-mail voltam com ?code=… (compatível com o HashRouter e mais seguro)
          flowType: 'pkce',
          storageKey: 'arco.auth',
        },
      }),
    };
  }
  return cached.client;
}

/* ---------- mapeamento camelCase <-> snake_case ---------- */
type Row = Record<string, unknown>;
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

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
  supplierId: s(r.supplier_id),
  leadTimeDays: n(r.lead_time_days),
  isKit: r.is_kit === true,
  kitItems: arr<KitItem>(r.kit_items),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

/** Sem stock: o saldo é mantido exclusivamente pelo trigger das movimentações. */
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
  supplier_id: p.supplierId || null,
  lead_time_days: p.leadTimeDays,
  is_kit: p.isKit,
  kit_items: p.kitItems,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
});

const storeFromRow = (r: Row): Store => ({
  id: s(r.id),
  name: s(r.name),
  channel: s(r.channel),
  color: s(r.color) || '#6366f1',
  active: r.active !== false,
  commissionPct: n(r.commission_pct),
  fixedFee: n(r.fixed_fee),
  monthlyGoal: n(r.monthly_goal),
  createdAt: s(r.created_at),
});

const storeToRow = (x: Store): Row => ({
  id: x.id,
  name: x.name,
  channel: x.channel,
  color: x.color,
  active: x.active,
  commission_pct: x.commissionPct,
  fixed_fee: x.fixedFee,
  monthly_goal: x.monthlyGoal,
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

const supplierFromRow = (r: Row): Supplier => ({
  id: s(r.id),
  name: s(r.name),
  document: s(r.document),
  contact: s(r.contact),
  phone: s(r.phone),
  email: s(r.email),
  website: s(r.website),
  category: s(r.category),
  ratings: { quality: 0, delivery: 0, price: 0, service: 0, ...((r.ratings as Partial<Supplier['ratings']>) ?? {}) },
  leadTimeDays: n(r.lead_time_days),
  notes: s(r.notes),
  productCodes: r.product_codes && typeof r.product_codes === 'object' ? (r.product_codes as Supplier['productCodes']) : {},
  createdAt: s(r.created_at),
});

const supplierToRow = (x: Supplier): Row => ({
  id: x.id,
  name: x.name,
  document: x.document,
  contact: x.contact,
  phone: x.phone,
  email: x.email,
  website: x.website,
  category: x.category,
  ratings: x.ratings,
  lead_time_days: x.leadTimeDays,
  notes: x.notes,
  product_codes: x.productCodes,
  created_at: x.createdAt,
});

const purchaseFromRow = (r: Row): Purchase => ({
  id: s(r.id),
  number: s(r.number),
  supplierId: s(r.supplier_id),
  status: (s(r.status) || 'rascunho') as Purchase['status'],
  items: arr<PurchaseItem>(r.items),
  expectedAt: s(r.expected_at),
  notes: s(r.notes),
  invoiceNumber: s(r.invoice_number),
  invoiceKey: s(r.invoice_key),
  invoiceDate: s(r.invoice_date),
  invoiceTotal: n(r.invoice_total),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

const purchaseToRow = (p: Purchase): Row => ({
  id: p.id,
  number: p.number,
  supplier_id: p.supplierId || null,
  status: p.status,
  items: p.items,
  expected_at: p.expectedAt || null,
  notes: p.notes,
  invoice_number: p.invoiceNumber,
  invoice_key: p.invoiceKey,
  invoice_date: p.invoiceDate || null,
  invoice_total: p.invoiceTotal,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
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

function check(error: { message: string; code?: string } | null, ctx: string) {
  if (!error) return;
  if (error.code === '42501' || /row-level security|permission denied/i.test(error.message)) {
    throw new Error(`${ctx}: seu perfil não tem permissão para esta ação.`);
  }
  throw new Error(`${ctx}: ${error.message}`);
}

export function createSupabaseSource(sb: SupabaseClient): DataSource {
  return {
    kind: 'supabase',

    async load() {
      const [p, st, m, su, pu] = await Promise.all([
        fetchAll(sb, 'products'),
        fetchAll(sb, 'stores'),
        fetchAll(sb, 'movements'),
        fetchAll(sb, 'suppliers'),
        fetchAll(sb, 'purchase_orders'),
      ]);
      return {
        products: p.map(productFromRow),
        stores: st.map(storeFromRow),
        movements: m.map(movementFromRow),
        suppliers: su.map(supplierFromRow),
        purchases: pu.map(purchaseFromRow),
      };
    },

    async upsertProducts(ps) {
      await chunked(ps, 500, async (part) => {
        check((await sb.from('products').upsert(part.map(productToRow), { onConflict: 'id' })).error, 'Salvar produtos');
      });
    },

    async deleteProduct(id) {
      check((await sb.from('products').delete().eq('id', id)).error, 'Excluir produto');
    },

    async upsertStores(ss) {
      check((await sb.from('stores').upsert(ss.map(storeToRow), { onConflict: 'id' })).error, 'Salvar lojas');
    },

    async deleteStore(id) {
      check((await sb.from('stores').delete().eq('id', id)).error, 'Excluir loja');
    },

    async upsertSuppliers(ss) {
      check((await sb.from('suppliers').upsert(ss.map(supplierToRow), { onConflict: 'id' })).error, 'Salvar fornecedores');
    },

    async deleteSupplier(id) {
      check((await sb.from('suppliers').delete().eq('id', id)).error, 'Excluir fornecedor');
    },

    async upsertPurchases(ps) {
      check((await sb.from('purchase_orders').upsert(ps.map(purchaseToRow), { onConflict: 'id' })).error, 'Salvar pedido de compra');
    },

    async deletePurchase(id) {
      check((await sb.from('purchase_orders').delete().eq('id', id)).error, 'Excluir pedido de compra');
    },

    async addMovements(ms) {
      await chunked(ms, 500, async (part) => {
        check((await sb.from('movements').insert(part.map(movementToRow))).error, 'Registrar movimentações');
      });
    },

    async replaceAll(d) {
      const ZERO = '00000000-0000-0000-0000-000000000000';
      check((await sb.from('movements').delete().neq('id', ZERO)).error, 'Limpar movimentações');
      check((await sb.from('purchase_orders').delete().neq('id', ZERO)).error, 'Limpar compras');
      check((await sb.from('products').delete().neq('id', ZERO)).error, 'Limpar produtos');
      check((await sb.from('suppliers').delete().neq('id', ZERO)).error, 'Limpar fornecedores');
      check((await sb.from('stores').delete().neq('id', ZERO)).error, 'Limpar lojas');
      if (d.stores.length) check((await sb.from('stores').insert(d.stores.map(storeToRow))).error, 'Restaurar lojas');
      if (d.suppliers.length) check((await sb.from('suppliers').insert(d.suppliers.map(supplierToRow))).error, 'Restaurar fornecedores');
      await chunked(d.products, 500, async (part) => {
        check((await sb.from('products').insert(part.map(productToRow))).error, 'Restaurar produtos');
      });
      if (d.purchases.length) check((await sb.from('purchase_orders').insert(d.purchases.map(purchaseToRow))).error, 'Restaurar compras');
      // o trigger recompõe o saldo a partir das movimentações…
      await chunked(d.movements, 500, async (part) => {
        check((await sb.from('movements').insert(part.map(movementToRow))).error, 'Restaurar movimentações');
      });
      // …e regravamos o custo do backup (o trigger de custo médio alterou durante a carga)
      await chunked(d.products, 500, async (part) => {
        check((await sb.from('products').upsert(part.map(productToRow), { onConflict: 'id' })).error, 'Restaurar custos');
      });
    },
  };
}

/* ---------- segurança / administração ---------- */

const profileFromRow = (r: Row): Profile => ({
  id: s(r.id),
  email: s(r.email),
  name: s(r.name),
  role: (s(r.role) || 'leitura') as Role,
  active: r.active !== false,
  createdAt: s(r.created_at),
});

export async function fetchMyProfile(sb: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(`Perfil: ${error.message}. Rodou o supabase/schema.sql atualizado?`);
  return data ? profileFromRow(data as Row) : null;
}

export async function fetchProfiles(sb: SupabaseClient): Promise<Profile[]> {
  const { data, error } = await sb.from('profiles').select('*').order('created_at');
  check(error, 'Usuários');
  return ((data ?? []) as Row[]).map(profileFromRow);
}

export async function updateProfile(sb: SupabaseClient, id: string, patch: Partial<Pick<Profile, 'role' | 'active' | 'name'>>) {
  check((await sb.from('profiles').update(patch).eq('id', id)).error, 'Atualizar usuário');
}

export async function fetchSecurity(sb: SupabaseClient): Promise<SecuritySettings> {
  const { data, error } = await sb.from('app_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(`Configurações de segurança: ${error.message}. Rodou o supabase/schema.sql atualizado?`);
  const r = (data ?? {}) as Row;
  return { requireMfa: r.require_mfa !== false, idleMinutes: n(r.idle_minutes) || 30 };
}

export async function saveSecurity(sb: SupabaseClient, v: SecuritySettings) {
  check((await sb.from('app_settings').update({ require_mfa: v.requireMfa, idle_minutes: v.idleMinutes }).eq('id', 1)).error, 'Salvar segurança');
}

export interface AuditEntry {
  id: number;
  at: string;
  actorEmail: string;
  action: string;
  table: string;
  recordId: string;
  oldData: Row | null;
  newData: Row | null;
}

export async function fetchAudit(sb: SupabaseClient, opts: { table?: string; limit?: number } = {}): Promise<AuditEntry[]> {
  let q = sb.from('audit_log').select('*').order('at', { ascending: false }).limit(opts.limit ?? 300);
  if (opts.table) q = q.eq('table_name', opts.table);
  const { data, error } = await q;
  check(error, 'Auditoria');
  return ((data ?? []) as Row[]).map((r) => ({
    id: n(r.id),
    at: s(r.at),
    actorEmail: s(r.actor_email) || 'sistema',
    action: s(r.action),
    table: s(r.table_name),
    recordId: s(r.record_id),
    oldData: (r.old_data as Row) ?? null,
    newData: (r.new_data as Row) ?? null,
  }));
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
