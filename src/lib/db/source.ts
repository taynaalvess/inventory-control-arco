import type { Dataset, Movement, Product, Purchase, Store, Supplier } from '../types';

/**
 * Camada de dados. Duas implementações:
 *  - local: IndexedDB do navegador (zero configuração, um dispositivo, sem login)
 *  - supabase: Postgres na nuvem (vários dispositivos, login, MFA, permissões por perfil)
 *
 * Regras de ouro:
 *  - o saldo (product.stock) só muda via addMovements;
 *  - entradas com custo atualizam o custo médio ponderado do produto.
 */
export interface DataSource {
  kind: 'local' | 'supabase';
  load(): Promise<Dataset>;
  upsertProducts(ps: Product[]): Promise<void>;
  deleteProduct(id: string): Promise<void>;
  upsertStores(ss: Store[]): Promise<void>;
  deleteStore(id: string): Promise<void>;
  upsertSuppliers(ss: Supplier[]): Promise<void>;
  deleteSupplier(id: string): Promise<void>;
  upsertPurchases(ps: Purchase[]): Promise<void>;
  deletePurchase(id: string): Promise<void>;
  addMovements(ms: Movement[]): Promise<void>;
  /** Substitui tudo (restauração de backup). O saldo é recalculado a partir das movimentações. */
  replaceAll(d: Dataset): Promise<void>;
}

export function stockFromMovements(movements: Movement[]) {
  const map = new Map<string, number>();
  for (const m of movements) if (m.affectsStock) map.set(m.productId, (map.get(m.productId) ?? 0) + m.qty);
  return map;
}

/**
 * Aplica movimentações a uma lista de produtos: saldo + custo médio ponderado nas entradas.
 * Mesma regra do trigger do Supabase (apply_movement).
 */
export function applyMovements(products: Product[], ms: Movement[]): Product[] {
  const byId = new Map(products.map((p) => [p.id, { ...p }]));
  const now = new Date().toISOString();
  for (const m of ms) {
    const p = byId.get(m.productId);
    if (!p || !m.affectsStock) continue;
    if (m.type === 'entrada' && m.qty > 0 && m.unitCost !== null && m.unitCost >= 0) {
      const base = Math.max(0, p.stock);
      p.cost = base + m.qty > 0 ? Math.round(((base * p.cost + m.qty * m.unitCost) / (base + m.qty)) * 100) / 100 : m.unitCost;
    }
    p.stock += m.qty;
    p.updatedAt = now;
  }
  return products.map((p) => byId.get(p.id) ?? p);
}
