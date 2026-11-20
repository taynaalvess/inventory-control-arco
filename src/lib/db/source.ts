import type { Dataset, Movement, Product, Store } from '../types';

/**
 * Camada de dados. Duas implementações:
 *  - local: IndexedDB do navegador (zero configuração, um dispositivo)
 *  - supabase: Postgres gratuito na nuvem (vários dispositivos, login)
 *
 * Regra de ouro: o saldo (product.stock) só muda via addMovements.
 * upsertProducts nunca altera o saldo.
 */
export interface DataSource {
  kind: 'local' | 'supabase';
  load(): Promise<Dataset>;
  upsertProducts(ps: Product[]): Promise<void>;
  deleteProduct(id: string): Promise<void>;
  upsertStores(ss: Store[]): Promise<void>;
  deleteStore(id: string): Promise<void>;
  addMovements(ms: Movement[]): Promise<void>;
  /** Substitui tudo (restauração de backup). O saldo é recalculado a partir das movimentações. */
  replaceAll(d: Dataset): Promise<void>;
}

export function stockFromMovements(movements: Movement[]) {
  const map = new Map<string, number>();
  for (const m of movements) if (m.affectsStock) map.set(m.productId, (map.get(m.productId) ?? 0) + m.qty);
  return map;
}
