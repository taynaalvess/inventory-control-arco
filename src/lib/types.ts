export type MovementType = 'entrada' | 'saida' | 'venda' | 'devolucao' | 'ajuste';
export type MovementSource = 'manual' | 'bipagem' | 'importacao' | 'upseller' | 'demo';

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
  createdAt: string;
  updatedAt: string;
}

export interface Store {
  id: string;
  name: string;
  channel: string;
  color: string;
  active: boolean;
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

export interface Dataset {
  products: Product[];
  stores: Store[];
  movements: Movement[];
}

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

export const STORE_COLORS = ['#6366f1', '#f97316', '#10b981', '#eab308', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16', '#64748b'];
