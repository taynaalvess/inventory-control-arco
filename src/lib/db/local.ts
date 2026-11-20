import { get, set } from 'idb-keyval';
import { upgradeDataset, type Dataset } from '../types';
import { applyMovements, stockFromMovements, type DataSource } from './source';

const K = {
  products: 'arco.products',
  stores: 'arco.stores',
  movements: 'arco.movements',
  suppliers: 'arco.suppliers',
  purchases: 'arco.purchases',
} as const;

async function read(): Promise<Dataset> {
  const [products, stores, movements, suppliers, purchases] = await Promise.all([
    get(K.products),
    get(K.stores),
    get(K.movements),
    get(K.suppliers),
    get(K.purchases),
  ]);
  return upgradeDataset({ products, stores, movements, suppliers, purchases });
}

export function readLocalDataset() {
  return read();
}

async function upsert<T extends { id: string }>(key: string, current: T[], rows: T[], merge?: (prev: T | undefined, next: T) => T) {
  const map = new Map(current.map((r) => [r.id, r]));
  for (const r of rows) map.set(r.id, merge ? merge(map.get(r.id), r) : r);
  await set(key, [...map.values()]);
}

export function createLocalSource(): DataSource {
  return {
    kind: 'local',
    load: read,

    async upsertProducts(ps) {
      const { products } = await read();
      // saldo e custo médio nunca vêm do formulário: preservamos o que está salvo
      await upsert(K.products, products, ps, (prev, p) => ({ ...p, stock: prev?.stock ?? 0 }));
    },

    async deleteProduct(id) {
      const d = await read();
      await set(K.products, d.products.filter((p) => p.id !== id));
      await set(K.movements, d.movements.filter((m) => m.productId !== id));
    },

    async upsertStores(ss) {
      await upsert(K.stores, (await read()).stores, ss);
    },

    async deleteStore(id) {
      const d = await read();
      await set(K.stores, d.stores.filter((s) => s.id !== id));
      await set(K.movements, d.movements.map((m) => (m.storeId === id ? { ...m, storeId: null } : m)));
    },

    async upsertSuppliers(ss) {
      await upsert(K.suppliers, (await read()).suppliers, ss);
    },

    async deleteSupplier(id) {
      const d = await read();
      await set(K.suppliers, d.suppliers.filter((s) => s.id !== id));
      await set(K.products, d.products.map((p) => (p.supplierId === id ? { ...p, supplierId: '' } : p)));
    },

    async upsertPurchases(ps) {
      await upsert(K.purchases, (await read()).purchases, ps);
    },

    async deletePurchase(id) {
      const d = await read();
      await set(K.purchases, d.purchases.filter((p) => p.id !== id));
    },

    async addMovements(ms) {
      const d = await read();
      await set(K.products, applyMovements(d.products, ms));
      await set(K.movements, [...d.movements, ...ms]);
    },

    async replaceAll(data) {
      const stock = stockFromMovements(data.movements);
      await set(K.stores, data.stores);
      await set(K.suppliers, data.suppliers);
      await set(K.purchases, data.purchases);
      await set(K.products, data.products.map((p) => ({ ...p, stock: stock.get(p.id) ?? 0 })));
      await set(K.movements, data.movements);
    },
  };
}
