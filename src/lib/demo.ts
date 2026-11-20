import { addDays, uid } from './format';
import { blankProduct, buildMovement } from './store';
import type { Dataset, Movement, Product, Store } from './types';

const CATALOG: [string, string, number, number][] = [
  ['Fone Bluetooth TWS Pro', 'Áudio', 39.9, 119.9],
  ['Caixa de Som Portátil 10W', 'Áudio', 45, 139.9],
  ['Carregador Turbo USB-C 25W', 'Acessórios', 18.5, 59.9],
  ['Cabo USB-C 2m Nylon', 'Acessórios', 6.2, 29.9],
  ['Capinha Silicone iPhone 15', 'Capas', 4.9, 34.9],
  ['Película 3D Galaxy S24', 'Capas', 2.1, 19.9],
  ['Smartwatch Fit 2', 'Wearables', 89, 249.9],
  ['Pulseira Smartwatch Sport', 'Wearables', 7.5, 29.9],
  ['Suporte Veicular Magnético', 'Acessórios', 11, 44.9],
  ['Power Bank 10000mAh', 'Energia', 42, 129.9],
  ['Ring Light 26cm + Tripé', 'Foto', 38, 99.9],
  ['Mouse Sem Fio Silencioso', 'Informática', 19.9, 69.9],
  ['Teclado Bluetooth Slim', 'Informática', 55, 159.9],
  ['Hub USB 4 portas 3.0', 'Informática', 22, 74.9],
  ['Lâmpada Smart Wi-Fi RGB', 'Casa', 21, 69.9],
  ['Tomada Inteligente 10A', 'Casa', 24.5, 79.9],
  ['Mini Projetor HD', 'Vídeo', 210, 549.9],
  ['Webcam Full HD', 'Informática', 64, 189.9],
  ['Headset Gamer RGB', 'Áudio', 58, 179.9],
  ['Mousepad Gamer XL', 'Informática', 14, 49.9],
];

function ean13(base: number) {
  const digits = String(789_0000_00000 + base).padStart(12, '0').slice(0, 12);
  const sum = digits.split('').reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return digits + ((10 - (sum % 10)) % 10);
}

/** Dados fictícios para explorar o painel (90 dias de vendas em 4 lojas). */
export function generateDemo(): Dataset {
  const now = new Date();
  const created = addDays(now, -120).toISOString();
  const stores: Store[] = [
    { id: uid(), name: 'Shopee Arco', channel: 'Shopee', color: '#f97316', active: true, createdAt: created },
    { id: uid(), name: 'Mercado Livre Arco', channel: 'Mercado Livre', color: '#eab308', active: true, createdAt: created },
    { id: uid(), name: 'Amazon Arco', channel: 'Amazon', color: '#6366f1', active: true, createdAt: created },
    { id: uid(), name: 'Loja física', channel: 'Loja física', color: '#10b981', active: true, createdAt: created },
  ];
  const weights = [0.42, 0.33, 0.15, 0.1];

  const products: Product[] = CATALOG.map(([name, category, cost, price], i) =>
    blankProduct({
      sku: `ARC-${String(i + 1).padStart(3, '0')}`,
      ean: ean13(i + 1),
      name,
      category,
      brand: 'Arco',
      cost,
      price,
      minStock: 10 + (i % 4) * 5,
      location: `A${(i % 5) + 1}-P${(i % 3) + 1}`,
      createdAt: created,
    }),
  );

  const movements: Movement[] = [];
  const popularity: number[] = products.map((_, i) => (i < 4 ? 3 : i < 10 ? 1.5 : i === 16 ? 0 : 0.6));

  products.forEach((p) => {
    movements.push(
      buildMovement({ productId: p.id, type: 'entrada', qty: 50 + Math.round(Math.random() * 150), unitCost: p.cost, ref: 'NF-1001', note: 'Compra inicial', source: 'demo', createdAt: addDays(now, -95).toISOString() }),
    );
  });

  let order = 5000;
  for (let d = 89; d >= 0; d--) {
    const day = addDays(now, -d);
    const weekend = day.getDay() === 0 || day.getDay() === 6 ? 1.3 : 1;
    const growth = 0.7 + ((89 - d) / 89) * 0.6;
    const orders = Math.round((6 + Math.random() * 8) * weekend * growth);
    for (let o = 0; o < orders; o++) {
      const r = Math.random();
      let acc = 0;
      const store = stores[weights.findIndex((w) => (acc += w) >= r)] ?? stores[0];
      const lines = Math.random() < 0.2 ? 2 : 1;
      order++;
      for (let l = 0; l < lines; l++) {
        const totalPop = popularity.reduce((a, b) => a + b, 0);
        let pick = Math.random() * totalPop;
        const idx = popularity.findIndex((w) => (pick -= w) <= 0);
        const p = products[Math.max(0, idx)];
        const at = new Date(day);
        at.setHours(8 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60));
        movements.push(
          buildMovement({ productId: p.id, type: 'venda', qty: -(Math.random() < 0.15 ? 2 : 1), unitPrice: +(p.price * (0.9 + Math.random() * 0.1)).toFixed(2), unitCost: p.cost, storeId: store.id, ref: `PED-${order}`, source: 'demo', createdAt: at.toISOString() }),
        );
      }
    }
    if (d === 45) {
      products.slice(0, 6).forEach((p) =>
        movements.push(buildMovement({ productId: p.id, type: 'entrada', qty: 80, unitCost: p.cost, ref: 'NF-1002', note: 'Reposição', source: 'demo', createdAt: day.toISOString() })),
      );
    }
  }
  return { products, stores, movements };
}
