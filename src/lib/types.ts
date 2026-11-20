export type MovementType = 'entrada' | 'saida' | 'venda' | 'devolucao' | 'ajuste';
export type MovementSource = 'manual' | 'bipagem' | 'importacao' | 'upseller' | 'demo' | 'compra' | 'kit';

export interface KitItem {
  productId: string;
  qty: number;
}

export interface Product {
  id: string;
  sku: string;
  ean: string;
  name: string;
  category: string;
  brand: string;
  cost: number;
  price: number;
  minStock: number;
  location: string;
  /** Saldo atual. Só muda através de movimentações (trilha de auditoria). */
  stock: number;
  imageUrl: string;
  active: boolean;
  upsellerId: string;
  supplierId: string;
  /** Prazo de entrega do fornecedor em dias (para sugestão de compra). */
  leadTimeDays: number;
  /** Kit/combo: não tem saldo próprio, baixa os componentes. */
  isKit: boolean;
  kitItems: KitItem[];
  createdAt: string;
  updatedAt: string;
}

export interface Store {
  id: string;
  name: string;
  channel: string;
  color: string;
  active: boolean;
  /** Comissão do marketplace em % sobre o faturamento. */
  commissionPct: number;
  /** Taxa fixa por pedido (R$). */
  fixedFee: number;
  /** Meta de faturamento mensal (R$). */
  monthlyGoal: number;
  createdAt: string;
}

export interface Movement {
  id: string;
  productId: string;
  type: MovementType;
  /** Variação de estoque com sinal: entrada/devolução positivas, saída/venda negativas. */
  qty: number;
  unitPrice: number | null;
  unitCost: number | null;
  storeId: string | null;
  /** Referência: nº do pedido, nota fiscal, sessão de bipagem... */
  ref: string;
  note: string;
  source: MovementSource;
  /** false = registra só para métricas (ex.: vendas cujo estoque já é baixado pelo ERP). */
  affectsStock: boolean;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  document: string;
  contact: string;
  phone: string;
  email: string;
  website: string;
  /** Segmento: Pet, Bike, Doméstico… */
  category: string;
  /** Avaliação 0–5 por critério (0 = não avaliado). */
  ratings: SupplierRatings;
  leadTimeDays: number;
  notes: string;
  /** Memória da NF-e: código do produto no fornecedor (cProd) → produto + fator de conversão. */
  productCodes: Record<string, { productId: string; factor: number }>;
  createdAt: string;
}

export interface SupplierRatings {
  quality: number;
  delivery: number;
  price: number;
  service: number;
}

export const SUPPLIER_CATEGORIES = [
  'Pet',
  'Bike',
  'Doméstico',
  'Eletrônicos',
  'Informática',
  'Moda',
  'Beleza',
  'Esporte',
  'Brinquedos',
  'Ferramentas',
  'Papelaria',
  'Embalagens',
  'Alimentos',
  'Automotivo',
];

export type PurchaseStatus = 'rascunho' | 'enviado' | 'parcial' | 'recebido' | 'cancelado';

export interface PurchaseItem {
  productId: string;
  qty: number;
  received: number;
  unitCost: number;
}

export interface Purchase {
  id: string;
  number: string;
  supplierId: string;
  status: PurchaseStatus;
  items: PurchaseItem[];
  expectedAt: string;
  notes: string;
  /** Dados da NF-e vinculada (quando importada). */
  invoiceNumber: string;
  invoiceKey: string;
  invoiceDate: string;
  invoiceTotal: number;
  createdAt: string;
  updatedAt: string;
}

export interface Dataset {
  products: Product[];
  stores: Store[];
  movements: Movement[];
  suppliers: Supplier[];
  purchases: Purchase[];
}

export type Role = 'admin' | 'gestor' | 'operador' | 'leitura';

export interface Profile {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface SecuritySettings {
  requireMfa: boolean;
  idleMinutes: number;
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  operador: 'Operador',
  leitura: 'Somente leitura',
};

export const ROLE_HINT: Record<Role, string> = {
  admin: 'Tudo, inclusive usuários, segurança, auditoria e exclusões',
  gestor: 'Gerencia produtos, lojas, compras, importações e relatórios',
  operador: 'Bipagem, recebimento de compras e consulta de produtos (sem valores)',
  leitura: 'Vê dashboard, lojas e relatórios, sem alterar nada',
};

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  venda: 'Venda',
  devolucao: 'Devolução',
  ajuste: 'Ajuste',
};

export const SOURCE_LABEL: Record<MovementSource, string> = {
  manual: 'Manual',
  bipagem: 'Bipagem',
  importacao: 'Planilha',
  upseller: 'UpSeller',
  demo: 'Demo',
  compra: 'Compra',
  kit: 'Kit',
};

export const PURCHASE_LABEL: Record<PurchaseStatus, string> = {
  rascunho: 'Rascunho',
  enviado: 'Enviado',
  parcial: 'Recebido parcial',
  recebido: 'Recebido',
  cancelado: 'Cancelado',
};

export const CHANNELS = [
  'Shopee',
  'Mercado Livre',
  'Amazon',
  'Magalu',
  'Shein',
  'TikTok Shop',
  'Americanas',
  'Site próprio',
  'Loja física',
  'Outro',
];

/** Comissões aproximadas de referência (confira o seu contrato/categoria). */
export const CHANNEL_DEFAULT_FEES: Record<string, { commissionPct: number; fixedFee: number }> = {
  Shopee: { commissionPct: 20, fixedFee: 4 },
  'Mercado Livre': { commissionPct: 16, fixedFee: 6.25 },
  Amazon: { commissionPct: 15, fixedFee: 0 },
  Magalu: { commissionPct: 16, fixedFee: 0 },
  Shein: { commissionPct: 16, fixedFee: 0 },
  'TikTok Shop': { commissionPct: 12, fixedFee: 0 },
  Americanas: { commissionPct: 16, fixedFee: 0 },
};

export const STORE_COLORS = ['#6366f1', '#f97316', '#10b981', '#eab308', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16', '#64748b'];

export const emptyDataset = (): Dataset => ({ products: [], stores: [], movements: [], suppliers: [], purchases: [] });

/** Garante campos novos em dados antigos (backups, IndexedDB). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = { [K in keyof Dataset]?: any[] };

export function upgradeDataset(d: Loose): Dataset {
  return {
    products: (d.products ?? []).map((p) => ({
      supplierId: '',
      leadTimeDays: 0,
      isKit: false,
      kitItems: [],
      ...p,
    })),
    stores: (d.stores ?? []).map((s) => ({ commissionPct: 0, fixedFee: 0, monthlyGoal: 0, ...s })),
    movements: d.movements ?? [],
    suppliers: (d.suppliers ?? []).map((s) => ({ website: '', category: '', productCodes: {}, ...s, ratings: { quality: 0, delivery: 0, price: 0, service: 0, ...(s.ratings ?? {}) } })),
    purchases: (d.purchases ?? []).map((p) => ({ invoiceNumber: '', invoiceKey: '', invoiceDate: '', invoiceTotal: 0, ...p })),
  };
}
