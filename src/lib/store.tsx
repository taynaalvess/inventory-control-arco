import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isCloudReady, loadConfig, saveConfig, type AppConfig } from './config';
import { createLocalSource } from './db/local';
import { createSupabaseSource, getSupabase } from './db/supabase';
import { stockFromMovements, type DataSource } from './db/source';
import { errMsg, norm, uid } from './format';
import type { Dataset, Movement, MovementSource, MovementType, Product, Store } from './types';

export type Status = 'loading' | 'auth' | 'ready' | 'error';

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
  supabase: SupabaseClient | null;
  userEmail: string | null;
  signOut(): Promise<void>;
  reload(): Promise<void>;
  productById: Map<string, Product>;
  storeById: Map<string, Store>;
  findByCode(code: string): Product | undefined;
  saveProduct(p: Product, initialStock?: number): Promise<Product>;
  saveProducts(ps: Product[]): Promise<void>;
  deleteProduct(id: string): Promise<void>;
  saveStore(s: Store): Promise<void>;
  saveStores(ss: Store[]): Promise<void>;
  deleteStore(id: string): Promise<void>;
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
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
};

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

const EMPTY: Dataset = { products: [], stores: [], movements: [] };

export function StoreProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<AppConfig>(loadConfig);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [data, setData] = useState<Dataset>(EMPTY);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const supabase = useMemo(
    () => (isCloudReady(config) ? getSupabase(config.supabaseUrl, config.supabaseKey) : null),
    [config],
  );
  const source: DataSource = useMemo(
    () => (supabase ? createSupabaseSource(supabase) : createLocalSource()),
    [supabase],
  );

  const reload = useCallback(async () => {
    try {
      setError('');
      setData(await source.load());
      setStatus('ready');
    } catch (e) {
      setError(errMsg(e));
      setStatus('error');
    }
  }, [source]);

  useEffect(() => {
    setStatus('loading');
    setData(EMPTY);
    if (!supabase) {
      setUserEmail(null);
      void reload();
      return;
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setUserEmail(session?.user.email ?? null);
      if (!session) setStatus('auth');
      else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') void reload();
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase, reload]);

  const setConfig = useCallback((c: AppConfig) => {
    saveConfig(c);
    setConfigState(c);
  }, []);

  const productById = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const storeById = useMemo(() => new Map(data.stores.map((s) => [s.id, s])), [data.stores]);
  const codeIndex = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of data.products) {
      if (p.sku) m.set(norm(p.sku), p);
    }
    // EAN tem prioridade sobre SKU em caso de colisão
    for (const p of data.products) if (p.ean) m.set(norm(p.ean), p);
    return m;
  }, [data.products]);

  const findByCode = useCallback((code: string) => codeIndex.get(norm(code)), [codeIndex]);

  const addMovements = useCallback(
    async (inputs: NewMovement[]) => {
      const list = inputs.filter((m) => m.qty !== 0).map(buildMovement);
      if (!list.length) return [];
      await source.addMovements(list);
      const deltas = stockFromMovements(list);
      const now = new Date().toISOString();
      setData((d) => ({
        ...d,
        movements: [...d.movements, ...list],
        products: d.products.map((p) =>
          deltas.has(p.id) ? { ...p, stock: p.stock + (deltas.get(p.id) ?? 0), updatedAt: now } : p,
        ),
      }));
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
      if (isNew && initialStock) {
        await addMovements([{ productId: p.id, type: 'ajuste', qty: initialStock, note: 'Estoque inicial', unitCost: p.cost }]);
      }
      return p;
    },
    [saveProducts, addMovements],
  );

  const deleteProduct = useCallback(
    async (id: string) => {
      await source.deleteProduct(id);
      setData((d) => ({
        ...d,
        products: d.products.filter((p) => p.id !== id),
        movements: d.movements.filter((m) => m.productId !== id),
      }));
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

  const adjustStockTo = useCallback(
    async (targets: { productId: string; target: number }[], note: string, src: MovementSource = 'manual') => {
      const byId = new Map(dataRef.current.products.map((p) => [p.id, p]));
      const moves: NewMovement[] = [];
      for (const t of targets) {
        const p = byId.get(t.productId);
        if (!p) continue;
        const delta = t.target - p.stock;
        if (delta !== 0) moves.push({ productId: p.id, type: 'ajuste', qty: delta, note, source: src, unitCost: p.cost });
      }
      await addMovements(moves);
      return moves.length;
    },
    [addMovements],
  );

  const replaceAll = useCallback(
    async (d: Dataset) => {
      await source.replaceAll(d);
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
    supabase,
    userEmail,
    signOut,
    reload,
    productById,
    storeById,
    findByCode,
    saveProduct,
    saveProducts,
    deleteProduct,
    saveStore,
    saveStores,
    deleteStore,
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
