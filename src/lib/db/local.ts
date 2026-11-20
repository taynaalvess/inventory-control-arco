import { get, set } from 'idb-keyval';
import type { Dataset, Movement, Product, Store } from '../types';
import { stockFromMovements, type DataSource } from './source';

const K = { products: 'arco.products', stores: 'arco.stores', movements: 'arco.movements' };

async function read(): Promise<Dataset> {
  const [products, stores, movements] = await Promise.all([
    get<Product[]>(K.products),
    get<Store[]>(K.stores),
    get<Movement[]>(K.movements),
  ]);
  return { products: products ?? [], stores: stores ?? [], movements: movements ?? [] };
}

export function readLocalDataset() {
  return read();
}

export function createLocalSource(): DataSource {
  return {
    kind: 'local',
    load: read,

    async upsertProducts(ps) {
      const { products } = await read();
      const map = new Map(products.map((p) => [p.id, p]));
      for (const p of ps) map.set(p.id, { ...p, stock: map.get(p.id)?.stock ?? 0 });
      await set(K.products, [...map.values()]);
    },

    async deleteProduct(id) {
      const d = await read();
      await set(K.products, d.products.filter((p) => p.id !== id));
      await set(K.movements, d.movements.filter((m) => m.productId !== id));
    },

    async upsertStores(ss) {
      const { stores } = await read();
      const map = new Map(stores.map((s) => [s.id, s]));
      for (const s of ss) map.set(s.id, s);
      await set(K.stores, [...map.values()]);
    },

    async deleteStore(id) {
      const d = await read();
      await set(K.stores, d.stores.filter((s) => s.id !== id));
      await set(K.movements, d.movements.map((m) => (m.storeId === id ? { ...m, storeId: null } : m)));
    },

    async addMovements(ms) {
      const d = await read();
      const deltas = stockFromMovements(ms);
      const now = new Date().toISOString();
      const products = d.products.map((p) =>
        deltas.has(p.id) ? { ...p, stock: p.stock + (deltas.get(p.id) ?? 0), updatedAt: now } : p,
      );
      await set(K.products, products);
      await set(K.movements, [...d.movements, ...ms]);
    },

    async replaceAll(data) {
      const stock = stockFromMovements(data.movements);
      await set(K.stores, data.stores);
      await set(K.products, data.products.map((p) => ({ ...p, stock: stock.get(p.id) ?? 0 })));
      await set(K.movements, data.movements);
    },
  };
}
