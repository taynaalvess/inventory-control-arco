import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { hasEnvSupabase, isCloudReady, loadConfig, saveConfig, type AppConfig } from './config';
import { createLocalSource } from './db/local';
import { createSupabaseSource, fetchMyProfile, fetchSecurity, getSupabase } from './db/supabase';
import { applyMovements, type DataSource } from './db/source';
import { errMsg, norm, uid } from './format';
import {
  emptyDataset,
  upgradeDataset,
  type Dataset,
  type Movement,
  type MovementSource,
  type MovementType,
  type Product,
  type Profile,
  type Purchase,
  type Role,
  type SecuritySettings,
  type Store,
  type Supplier,
} from './types';

export type Status = 'loading' | 'auth' | 'mfa-enroll' | 'mfa-challenge' | 'recovery' | 'blocked' | 'ready' | 'error';

/** Capacidades por perfil. A mesma regra é aplicada no banco (RLS) — a interface só esconde o que o banco já bloqueia. */
export type Cap = 'finance' | 'scan' | 'manage' | 'admin';
const CAPS: Record<Role, Cap[]> = {
  admin: ['finance', 'scan', 'manage', 'admin'],
  gestor: ['finance', 'scan', 'manage'],
  operador: ['scan'],
  leitura: ['finance'],
};

export interface NewMovement {
  productId: string;
  type: MovementType;
  qty: number;
  unitPrice?: number | null;
  unitCost?: number | null;
  storeId?: string | null;
  ref?: string;
  note?: string;
  source?: MovementSource;
  affectsStock?: boolean;
  createdAt?: string;
}

interface Ctx extends Dataset {
  status: Status;
  error: string;
  config: AppConfig;
  setConfig(c: AppConfig): void;
  locked: boolean;
  supabase: SupabaseClient | null;
  session: Session | null;
  profile: Profile | null;
  role: Role;
  can(cap: Cap): boolean;
  security: SecuritySettings;
  setSecurityState(s: SecuritySettings): void;
  recheck(): Promise<void>;
  signOut(): Promise<void>;
  reload(): Promise<void>;
  productById: Map<string, Product>;
  storeById: Map<string, Store>;
  supplierById: Map<string, Supplier>;
  findByCode(code: string): Product | undefined;
  kitAvailable(p: Product): number;
  saveProduct(p: Product, initialStock?: number): Promise<Product>;
  saveProducts(ps: Product[]): Promise<void>;
  deleteProduct(id: string): Promise<void>;
  saveStore(s: Store): Promise<void>;
  saveStores(ss: Store[]): Promise<void>;
  deleteStore(id: string): Promise<void>;
  saveSupplier(s: Supplier): Promise<void>;
  deleteSupplier(id: string): Promise<void>;
  savePurchase(p: Purchase): Promise<void>;
  deletePurchase(id: string): Promise<void>;
  receivePurchase(p: Purchase, receipts: { productId: string; qty: number }[], note?: string): Promise<void>;
  nextPurchaseNumber(): string;
  addMovements(ms: NewMovement[]): Promise<Movement[]>;
  adjustStockTo(targets: { productId: string; target: number }[], note: string, source?: MovementSource): Promise<number>;
  replaceAll(d: Dataset): Promise<void>;
}

const StoreCtx = createContext<Ctx | null>(null);

export const blankProduct = (patch: Partial<Product> = {}): Product => {
  const now = new Date().toISOString();
  return {
    id: uid(),
    sku: '',
    ean: '',
    name: '',
    category: '',
    brand: '',
    cost: 0,
    price: 0,
    minStock: 0,
    location: '',
    stock: 0,
    imageUrl: '',
    active: true,
    upsellerId: '',
    supplierId: '',
    leadTimeDays: 0,
    isKit: false,
    kitItems: [],
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
};

export const blankStore = (patch: Partial<Store> = {}): Store => ({
  id: uid(),
  name: '',
  channel: 'Outro',
  color: '#6366f1',
  active: true,
  commissionPct: 0,
  fixedFee: 0,
  monthlyGoal: 0,
  createdAt: new Date().toISOString(),
  ...patch,
});

export function buildMovement(m: NewMovement): Movement {
  return {
    id: uid(),
    productId: m.productId,
    type: m.type,
    qty: m.qty,
    unitPrice: m.unitPrice ?? null,
    unitCost: m.unitCost ?? null,
    storeId: m.storeId ?? null,
    ref: m.ref ?? '',
    note: m.note ?? '',
    source: m.source ?? 'manual',
    affectsStock: m.affectsStock ?? true,
    createdAt: m.createdAt ?? new Date().toISOString(),
  };
}

export const kitCost = (p: Product, byId: Map<string, Product>) =>
  p.kitItems.reduce((s, it) => s + (byId.get(it.productId)?.cost ?? 0) * it.qty, 0);

/** Kit: registra a venda no kit (só métrica) e baixa/repõe cada componente. */
export function expandKits(inputs: NewMovement[], byId: Map<string, Product>): NewMovement[] {
  const out: NewMovement[] = [];
  for (const m of inputs) {
    const p = byId.get(m.productId);
    if (!p?.isKit || !p.kitItems.length) {
      out.push(m);
      continue;
    }
    if (m.type === 'ajuste') continue; // kit não tem saldo próprio
    out.push({ ...m, affectsStock: false, unitCost: m.unitCost ?? kitCost(p, byId) });
    if (m.affectsStock === false) continue;
    for (const it of p.kitItems) {
      const c = byId.get(it.productId);
      if (!c) continue;
      out.push({
        productId: c.id,
        type: m.qty < 0 ? 'saida' : 'entrada',
        qty: m.qty * it.qty,
        unitCost: c.cost,
        storeId: m.storeId,
        ref: m.ref,
        note: `Kit ${p.sku}${m.note ? ` · ${m.note}` : ''}`,
        source: 'kit',
        createdAt: m.createdAt,
      });
    }
  }
  return out;
}

const DEFAULT_SECURITY: SecuritySettings = { requireMfa: true, idleMinutes: 30 };

export function StoreProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<AppConfig>(loadConfig);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [data, setData] = useState<Dataset>(emptyDataset);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [security, setSecurityState] = useState<SecuritySettings>(DEFAULT_SECURITY);
  const dataRef = useRef(data);
  dataRef.current = data;
  const recovering = useRef(false);

  const supabase = useMemo(
    () => (isCloudReady(config) ? getSupabase(config.supabaseUrl, config.supabaseKey) : null),
    [config],
  );
  const source: DataSource = useMemo(() => (supabase ? createSupabaseSource(supabase) : createLocalSource()), [supabase]);

  const reload = useCallback(async () => {
    try {
      setError('');
      setData(upgradeDataset(await source.load()));
      setStatus('ready');
    } catch (e) {
      setError(errMsg(e));
      setStatus('error');
    }
  }, [source]);

  /** Decide o próximo passo após login: conta ativa → MFA → dados. */
  const evaluate = useCallback(
    async (sb: SupabaseClient, s: Session) => {
      try {
        const [sec, prof] = await Promise.all([fetchSecurity(sb), fetchMyProfile(sb, s.user.id)]);
        setSecurityState(sec);
        setProfile(prof);
        if (recovering.current) return setStatus('recovery');
        if (!prof || !prof.active) return setStatus('blocked');
        const [{ data: aal }, { data: factors }] = await Promise.all([sb.auth.mfa.getAuthenticatorAssuranceLevel(), sb.auth.mfa.listFactors()]);
        const verified = (factors?.totp ?? []).filter((f) => f.status === 'verified');
        if (aal?.currentLevel !== 'aal2') {
          if (verified.length) return setStatus('mfa-challenge');
          if (sec.requireMfa) return setStatus('mfa-enroll');
        }
        await reload();
      } catch (e) {
        setError(errMsg(e));
        setStatus('error');
      }
    },
    [reload],
  );

  useEffect(() => {
    setStatus('loading');
    setData(emptyDataset());
    setProfile(null);
    if (!supabase) {
      setSession(null);
      void reload();
      return;
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') {
        recovering.current = true;
        setStatus('recovery');
        return;
      }
      if (!s) {
        recovering.current = false;
        setProfile(null);
        setData(emptyDataset());
        setStatus('auth');
        return;
      }
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'MFA_CHALLENGE_VERIFIED') {
        // fora do callback: chamadas ao Supabase dentro dele podem travar
        setTimeout(() => void evaluate(supabase, s), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase, reload, evaluate]);

  const recheck = useCallback(async () => {
    if (!supabase) return reload();
    recovering.current = false;
    const { data: d } = await supabase.auth.getSession();
    if (d.session) await evaluate(supabase, d.session);
    else setStatus('auth');
  }, [supabase, evaluate, reload]);

  const setConfig = useCallback((c: AppConfig) => {
    saveConfig(c);
    setConfigState(c);
  }, []);

  const role: Role = supabase ? profile?.role ?? 'leitura' : 'admin';
  const can = useCallback((cap: Cap) => CAPS[role].includes(cap), [role]);

  const productById = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const storeById = useMemo(() => new Map(data.stores.map((s) => [s.id, s])), [data.stores]);
  const supplierById = useMemo(() => new Map(data.suppliers.map((s) => [s.id, s])), [data.suppliers]);
  const codeIndex = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of data.products) if (p.sku) m.set(norm(p.sku), p);
    for (const p of data.products) if (p.ean) m.set(norm(p.ean), p); // EAN tem prioridade
    return m;
  }, [data.products]);

  const findByCode = useCallback((code: string) => codeIndex.get(norm(code)), [codeIndex]);

  const kitAvailable = useCallback(
    (p: Product) => {
      if (!p.isKit || !p.kitItems.length) return p.stock;
      return Math.max(0, Math.min(...p.kitItems.map((it) => Math.floor((productById.get(it.productId)?.stock ?? 0) / (it.qty || 1)))));
    },
    [productById],
  );

  const addMovements = useCallback(
    async (inputs: NewMovement[]) => {
      const byId = new Map(dataRef.current.products.map((p) => [p.id, p]));
      const list = expandKits(inputs.filter((m) => m.qty !== 0), byId).map(buildMovement);
      if (!list.length) return [];
      await source.addMovements(list);
      setData((d) => ({ ...d, movements: [...d.movements, ...list], products: applyMovements(d.products, list) }));
      return list;
    },
    [source],
  );

  const validateProducts = (ps: Product[]) => {
    const incoming = new Set(ps.map((p) => p.id));
    const sku = new Map<string, string>();
    const ean = new Map<string, string>();
    for (const p of dataRef.current.products) {
      if (incoming.has(p.id)) continue;
      if (p.sku) sku.set(norm(p.sku), p.name);
      if (p.ean) ean.set(norm(p.ean), p.name);
    }
    for (const p of ps) {
      if (!p.sku.trim()) throw new Error('Informe o SKU do produto.');
      if (!p.name.trim()) throw new Error(`Informe o nome do produto (SKU ${p.sku}).`);
      const k = norm(p.sku);
      if (sku.has(k)) throw new Error(`SKU "${p.sku}" já está em uso por "${sku.get(k)}".`);
      sku.set(k, p.name);
      if (p.ean) {
        const e = norm(p.ean);
        if (ean.has(e)) throw new Error(`Código de barras "${p.ean}" já está em uso por "${ean.get(e)}".`);
        ean.set(e, p.name);
      }
      if (p.isKit) {
        if (!p.kitItems.length) throw new Error(`O kit "${p.name}" precisa de pelo menos um componente.`);
        if (p.kitItems.some((it) => it.productId === p.id)) throw new Error('Um kit não pode conter ele mesmo.');
        if (p.kitItems.some((it) => dataRef.current.products.find((x) => x.id === it.productId)?.isKit))
          throw new Error('Um kit não pode conter outro kit.');
      }
    }
  };

  const saveProducts = useCallback(
    async (ps: Product[]) => {
      if (!ps.length) return;
      validateProducts(ps);
      const now = new Date().toISOString();
      const clean = ps.map((p) => ({ ...p, sku: p.sku.trim(), ean: p.ean.trim(), name: p.name.trim(), updatedAt: now }));
      await source.upsertProducts(clean);
      setData((d) => {
        const map = new Map(d.products.map((p) => [p.id, p]));
        for (const p of clean) map.set(p.id, { ...p, stock: map.get(p.id)?.stock ?? 0 });
        return { ...d, products: [...map.values()] };
      });
    },
    [source],
  );

  const saveProduct = useCallback(
    async (p: Product, initialStock = 0) => {
      const isNew = !dataRef.current.products.some((x) => x.id === p.id);
      await saveProducts([p]);
      if (isNew && initialStock && !p.isKit) {
        await addMovements([{ productId: p.id, type: 'ajuste', qty: initialStock, note: 'Estoque inicial' }]);
      }
      return p;
    },
    [saveProducts, addMovements],
  );

  const deleteProduct = useCallback(
    async (id: string) => {
      if (dataRef.current.products.some((p) => p.isKit && p.kitItems.some((it) => it.productId === id)))
        throw new Error('Este produto faz parte de um kit. Remova-o do kit antes de excluir.');
      await source.deleteProduct(id);
      setData((d) => ({ ...d, products: d.products.filter((p) => p.id !== id), movements: d.movements.filter((m) => m.productId !== id) }));
    },
    [source],
  );

  const saveStores = useCallback(
    async (ss: Store[]) => {
      if (!ss.length) return;
      for (const s of ss) if (!s.name.trim()) throw new Error('Informe o nome da loja.');
      await source.upsertStores(ss);
      setData((d) => {
        const map = new Map(d.stores.map((s) => [s.id, s]));
        for (const s of ss) map.set(s.id, s);
        return { ...d, stores: [...map.values()] };
      });
    },
    [source],
  );

  const saveStore = useCallback((s: Store) => saveStores([s]), [saveStores]);

  const deleteStore = useCallback(
    async (id: string) => {
      await source.deleteStore(id);
      setData((d) => ({
        ...d,
        stores: d.stores.filter((s) => s.id !== id),
        movements: d.movements.map((m) => (m.storeId === id ? { ...m, storeId: null } : m)),
      }));
    },
    [source],
  );

  const saveSupplier = useCallback(
    async (s: Supplier) => {
      if (!s.name.trim()) throw new Error('Informe o nome do fornecedor.');
      await source.upsertSuppliers([s]);
      setData((d) => ({ ...d, suppliers: [...d.suppliers.filter((x) => x.id !== s.id), s] }));
    },
    [source],
  );

  const deleteSupplier = useCallback(
    async (id: string) => {
      await source.deleteSupplier(id);
      setData((d) => ({
        ...d,
        suppliers: d.suppliers.filter((s) => s.id !== id),
        products: d.products.map((p) => (p.supplierId === id ? { ...p, supplierId: '' } : p)),
      }));
    },
    [source],
  );

  const savePurchase = useCallback(
    async (p: Purchase) => {
      if (!p.items.length) throw new Error('Adicione pelo menos um item ao pedido.');
      const clean = { ...p, updatedAt: new Date().toISOString() };
      await source.upsertPurchases([clean]);
      setData((d) => ({ ...d, purchases: [...d.purchases.filter((x) => x.id !== p.id), clean] }));
    },
    [source],
  );

  const deletePurchase = useCallback(
    async (id: string) => {
      await source.deletePurchase(id);
      setData((d) => ({ ...d, purchases: d.purchases.filter((x) => x.id !== id) }));
    },
    [source],
  );

  const receivePurchase = useCallback(
    async (p: Purchase, receipts: { productId: string; qty: number }[], note = '') => {
      const qtyBy = new Map<string, number>();
      for (const r of receipts) if (r.qty > 0) qtyBy.set(r.productId, (qtyBy.get(r.productId) ?? 0) + r.qty);
      if (!qtyBy.size) throw new Error('Nenhuma quantidade recebida.');
      const items = p.items.map((it) => ({ ...it, received: it.received + (qtyBy.get(it.productId) ?? 0) }));
      const done = items.every((it) => it.received >= it.qty);
      await addMovements(
        p.items
          .filter((it) => qtyBy.has(it.productId))
          .map((it) => ({
            productId: it.productId,
            type: 'entrada' as const,
            qty: qtyBy.get(it.productId)!,
            unitCost: it.unitCost,
            ref: p.number,
            note: note || `Recebimento ${p.number}`,
            source: 'compra' as const,
          })),
      );
      await savePurchase({ ...p, items, status: done ? 'recebido' : 'parcial' });
    },
    [addMovements, savePurchase],
  );

  const nextPurchaseNumber = useCallback(() => {
    const max = dataRef.current.purchases.reduce((m, p) => Math.max(m, Number(p.number.replace(/\D/g, '')) || 0), 1000);
    return `PC-${max + 1}`;
  }, []);

  const adjustStockTo = useCallback(
    async (targets: { productId: string; target: number }[], note: string, src: MovementSource = 'manual') => {
      const byId = new Map(dataRef.current.products.map((p) => [p.id, p]));
      const moves: NewMovement[] = [];
      for (const t of targets) {
        const p = byId.get(t.productId);
        if (!p || p.isKit) continue;
        const delta = t.target - p.stock;
        if (delta !== 0) moves.push({ productId: p.id, type: 'ajuste', qty: delta, note, source: src });
      }
      await addMovements(moves);
      return moves.length;
    },
    [addMovements],
  );

  const replaceAll = useCallback(
    async (d: Dataset) => {
      await source.replaceAll(upgradeDataset(d));
      await reload();
    },
    [source, reload],
  );

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, [supabase]);

  const value: Ctx = {
    ...data,
    status,
    error,
    config,
    setConfig,
    locked: hasEnvSupabase,
    supabase,
    session,
    profile,
    role,
    can,
    security,
    setSecurityState,
    recheck,
    signOut,
    reload,
    productById,
    storeById,
    supplierById,
    findByCode,
    kitAvailable,
    saveProduct,
    saveProducts,
    deleteProduct,
    saveStore,
    saveStores,
    deleteStore,
    saveSupplier,
    deleteSupplier,
    savePurchase,
    deletePurchase,
    receivePurchase,
    nextPurchaseNumber,
    addMovements,
    adjustStockTo,
    replaceAll,
  };

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore fora do StoreProvider');
  return ctx;
}
