import { addDays, uid } from './format';
import { blankProduct, blankStore, buildMovement, expandKits, type NewMovement } from './store';
import { CHANNEL_DEFAULT_FEES, type Dataset, type Movement, type Product, type Purchase, type Store, type Supplier } from './types';

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

/** Dados fictícios para explorar o painel: 90 dias de vendas em 4 lojas, kits, fornecedores e compras. */
export function generateDemo(): Dataset {
  const now = new Date();
  const created = addDays(now, -120).toISOString();
  const mk = (name: string, channel: string, color: string, monthlyGoal: number) =>
    blankStore({ name, channel, color, monthlyGoal, createdAt: created, ...(CHANNEL_DEFAULT_FEES[channel] ?? {}) });
  const stores: Store[] = [
    mk('Shopee Arco', 'Shopee', '#f97316', 22000),
    mk('Mercado Livre Arco', 'Mercado Livre', '#eab308', 18000),
    mk('Amazon Arco', 'Amazon', '#6366f1', 8000),
    mk('Loja física', 'Loja física', '#10b981', 5000),
  ];
  const weights = [0.42, 0.33, 0.15, 0.1];

  const suppliers: Supplier[] = [
    { id: uid(), name: 'Distribuidora Tech SP', document: '12.345.678/0001-90', contact: 'Carla', phone: '(11) 99999-0000', email: 'vendas@techsp.example', website: 'https://techsp.example', category: 'Eletrônicos', ratings: { quality: 5, delivery: 4, price: 3, service: 5 }, leadTimeDays: 7, notes: '', productCodes: {}, createdAt: created },
    { id: uid(), name: 'Importadora Oriente', document: '98.765.432/0001-10', contact: 'Wei', phone: '(11) 98888-1111', email: 'compras@oriente.example', website: '', category: 'Informática', ratings: { quality: 4, delivery: 2, price: 5, service: 3 }, leadTimeDays: 25, notes: 'Pedido mínimo R$ 3.000', productCodes: {}, createdAt: created },
  ];

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
      supplierId: suppliers[i % 3 === 0 ? 1 : 0].id,
      createdAt: created,
    }),
  );

  const byIdx = (i: number) => products[i];
  const kits = [
    blankProduct({
      sku: 'KIT-HOME',
      name: 'Kit Home Office (mouse + teclado + mousepad)',
      category: 'Kits',
      brand: 'Arco',
      price: 249.9,
      isKit: true,
      kitItems: [
        { productId: byIdx(11).id, qty: 1 },
        { productId: byIdx(12).id, qty: 1 },
        { productId: byIdx(19).id, qty: 1 },
      ],
      createdAt: created,
    }),
    blankProduct({
      sku: 'KIT-CARGA',
      name: 'Combo Carregador 25W + Cabo USB-C',
      category: 'Kits',
      brand: 'Arco',
      price: 79.9,
      isKit: true,
      kitItems: [
        { productId: byIdx(2).id, qty: 1 },
        { productId: byIdx(3).id, qty: 1 },
      ],
      createdAt: created,
    }),
  ];
  for (const k of kits) k.cost = k.kitItems.reduce((s, it) => s + (products.find((p) => p.id === it.productId)?.cost ?? 0), 0);
  const all = [...products, ...kits];
  const byId = new Map(all.map((p) => [p.id, p]));

  const inputs: NewMovement[] = [];
  products.forEach((p) => {
    inputs.push({ productId: p.id, type: 'entrada', qty: 50 + Math.round(Math.random() * 150), unitCost: p.cost, ref: 'NF-1001', note: 'Compra inicial', source: 'demo', createdAt: addDays(now, -95).toISOString() });
  });

  const sellable = [...products, ...kits];
  const popularity: number[] = sellable.map((p, i) => (p.isKit ? 1.2 : i < 4 ? 3 : i < 10 ? 1.5 : i === 16 ? 0 : 0.6));
  const totalPop = popularity.reduce((a, b) => a + b, 0);

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
        let pick = Math.random() * totalPop;
        const idx = popularity.findIndex((w) => (pick -= w) <= 0);
        const p = sellable[Math.max(0, idx)];
        const at = new Date(day);
        at.setHours(8 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60));
        inputs.push({ productId: p.id, type: 'venda', qty: -(Math.random() < 0.15 ? 2 : 1), unitPrice: +(p.price * (0.9 + Math.random() * 0.1)).toFixed(2), unitCost: p.cost, storeId: store.id, ref: `PED-${order}`, source: 'demo', createdAt: at.toISOString() });
      }
    }
    if (d === 45) {
      products.slice(0, 6).forEach((p) =>
        inputs.push({ productId: p.id, type: 'entrada', qty: 80, unitCost: +(p.cost * 1.05).toFixed(2), ref: 'PC-1001', note: 'Reposição', source: 'compra', createdAt: day.toISOString() }),
      );
    }
    if (d === 20) {
      inputs.push({ productId: products[5].id, type: 'ajuste', qty: -3, note: 'Inventário: avaria', source: 'bipagem', createdAt: day.toISOString() });
    }
  }

  const movements: Movement[] = expandKits(inputs, byId).map(buildMovement);

  const purchases: Purchase[] = [
    {
      id: uid(),
      number: 'PC-1001',
      supplierId: suppliers[0].id,
      status: 'recebido',
      items: products.slice(0, 6).map((p) => ({ productId: p.id, qty: 80, received: 80, unitCost: +(p.cost * 1.05).toFixed(2) })),
      expectedAt: '',
      notes: 'Reposição',
      invoiceNumber: '4512',
      invoiceKey: '',
      invoiceDate: addDays(now, -45).toISOString().slice(0, 10),
      invoiceTotal: 0,
      createdAt: addDays(now, -50).toISOString(),
      updatedAt: addDays(now, -45).toISOString(),
    },
    {
      id: uid(),
      number: 'PC-1002',
      supplierId: suppliers[1].id,
      status: 'enviado',
      items: [products[0], products[9], products[12]].map((p) => ({ productId: p.id, qty: 60, received: 0, unitCost: p.cost })),
      expectedAt: addDays(now, 10).toISOString().slice(0, 10),
      notes: '',
      invoiceNumber: '',
      invoiceKey: '',
      invoiceDate: '',
      invoiceTotal: 0,
      createdAt: addDays(now, -5).toISOString(),
      updatedAt: addDays(now, -5).toISOString(),
    },
  ];

  return { products: all, stores, movements, suppliers, purchases };
}
