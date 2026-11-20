import { useMemo, useState } from 'react';
import { ExternalLink, Pencil, Plus, Search, Star, Trash2, Users } from 'lucide-react';
import { useStore } from '../lib/store';
import { brl, errMsg, norm, num, pct, uid } from '../lib/format';
import { safeUrl } from '../lib/nfe';
import { SUPPLIER_CATEGORIES, type Purchase, type Supplier, type SupplierRatings } from '../lib/types';
import { Badge, Button, Card, Empty, Field, Input, Modal, Select, cx } from '../components/ui';
import { useToast } from '../components/toast';

const CRITERIA: { key: keyof SupplierRatings; label: string; hint: string }[] = [
  { key: 'quality', label: 'Qualidade', hint: 'Produto chega bom, sem avaria ou defeito' },
  { key: 'delivery', label: 'Prazo', hint: 'Cumpre o prazo combinado' },
  { key: 'price', label: 'Preço', hint: 'Custo competitivo e condições de pagamento' },
  { key: 'service', label: 'Atendimento', hint: 'Responde rápido, resolve problemas, troca' },
];

export const ratingAvg = (r: SupplierRatings) => {
  const vals = CRITERIA.map((c) => r[c.key]).filter((v) => v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
};

export function Stars({ value, onChange, size = 16 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <span className="inline-flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = shown >= i ? 1 : shown >= i - 0.5 ? 0.5 : 0;
        const icon = (
          <span className="relative inline-block" style={{ width: size, height: size }}>
            <Star size={size} className="absolute text-slate-300 dark:text-slate-600" />
            {fill > 0 && (
              <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: fill === 1 ? size : size / 2 }}>
                <Star size={size} className="fill-amber-400 text-amber-400" />
              </span>
            )}
          </span>
        );
        return onChange ? (
          <button key={i} type="button" onMouseEnter={() => setHover(i)} onClick={() => onChange(value === i ? 0 : i)} aria-label={`${i} estrela(s)`}>
            {icon}
          </button>
        ) : (
          <span key={i}>{icon}</span>
        );
      })}
    </span>
  );
}

interface Experience {
  orders: number;
  totalBought: number;
  onTime: number | null; // % entregue até a data prevista
  fillRate: number | null; // % do pedido que chegou
  lastPurchase: string;
  avgLeadDays: number | null; // dias reais do pedido até a 1ª entrega
}

/** Indicadores calculados automaticamente a partir dos pedidos e recebimentos. */
function useExperience() {
  const { purchases, movements } = useStore();
  return useMemo(() => {
    const firstReceipt = new Map<string, number>();
    for (const m of movements) {
      if (m.source !== 'compra' || !m.ref) continue;
      const t = new Date(m.createdAt).getTime();
      if (!firstReceipt.has(m.ref) || t < firstReceipt.get(m.ref)!) firstReceipt.set(m.ref, t);
    }
    const bySupplier = new Map<string, Purchase[]>();
    for (const p of purchases) if (p.supplierId && p.status !== 'cancelado') bySupplier.set(p.supplierId, [...(bySupplier.get(p.supplierId) ?? []), p]);

    const out = new Map<string, Experience>();
    for (const [sid, list] of bySupplier) {
      let total = 0,
        qty = 0,
        rec = 0,
        timed = 0,
        onTime = 0,
        leadSum = 0,
        leadN = 0,
        last = '';
      for (const p of list) {
        total += p.items.reduce((s, it) => s + Math.min(it.received, it.qty) * it.unitCost, 0) || p.invoiceTotal;
        if (p.createdAt > last) last = p.createdAt;
        const got = firstReceipt.get(p.number);
        if (p.status === 'recebido' || p.status === 'parcial') {
          qty += p.items.reduce((s, it) => s + it.qty, 0);
          rec += p.items.reduce((s, it) => s + Math.min(it.received, it.qty), 0);
        }
        if (got && p.expectedAt) {
          timed++;
          if (got <= new Date(`${p.expectedAt}T23:59:59`).getTime()) onTime++;
        }
        if (got && !p.invoiceKey) {
          const d = (got - new Date(p.createdAt).getTime()) / 86400000;
          if (d >= 0) {
            leadSum += d;
            leadN++;
          }
        }
      }
      out.set(sid, {
        orders: list.length,
        totalBought: total,
        onTime: timed ? onTime / timed : null,
        fillRate: qty ? rec / qty : null,
        lastPurchase: last,
        avgLeadDays: leadN ? leadSum / leadN : null,
      });
    }
    return out;
  }, [purchases, movements]);
}

export const blankSupplier = (patch: Partial<Supplier> = {}): Supplier => ({
  id: uid(),
  name: '',
  document: '',
  contact: '',
  phone: '',
  email: '',
  website: '',
  category: '',
  ratings: { quality: 0, delivery: 0, price: 0, service: 0 },
  leadTimeDays: 7,
  notes: '',
  productCodes: {},
  createdAt: new Date().toISOString(),
  ...patch,
});

export function SuppliersTab() {
  const { suppliers, products, saveSupplier, deleteSupplier, can } = useStore();
  const toast = useToast();
  const exp = useExperience();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'name' | 'rating' | 'bought'>('rating');
  const finance = can('finance');

  const categories = useMemo(() => [...new Set([...SUPPLIER_CATEGORIES, ...suppliers.map((s) => s.category).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'pt-BR')), [suppliers]);

  const list = useMemo(() => {
    const t = norm(q);
    return suppliers
      .filter((s) => (!category || s.category === category) && (!t || norm(`${s.name} ${s.document} ${s.contact} ${s.category}`).includes(t)))
      .sort((a, b) =>
        sort === 'rating'
          ? ratingAvg(b.ratings) - ratingAvg(a.ratings)
          : sort === 'bought'
            ? (exp.get(b.id)?.totalBought ?? 0) - (exp.get(a.id)?.totalBought ?? 0)
            : a.name.localeCompare(b.name, 'pt-BR'),
      );
  }, [suppliers, q, category, sort, exp]);

  async function remove(s: Supplier) {
    if (!window.confirm(`Excluir ${s.name}? Os produtos ficam sem fornecedor.`)) return;
    try {
      await deleteSupplier(s.id);
      toast('Fornecedor excluído');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  return (
    <>
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-3 sm:p-3">
        <div className="relative min-w-48 flex-1">
          <Search size={16} className="text-faint absolute top-1/2 left-3 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar fornecedor, CNPJ, contato…" className="pl-9" />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto">
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-auto">
          <option value="rating">Melhor avaliados</option>
          {finance && <option value="bought">Maior volume comprado</option>}
          <option value="name">Nome</option>
        </Select>
        <Button onClick={() => setEditing(blankSupplier())}>
          <Plus size={16} /> Novo fornecedor
        </Button>
      </Card>

      {list.length === 0 ? (
        <Card>
          <Empty icon={<Users size={36} />} title={suppliers.length ? 'Nenhum fornecedor encontrado' : 'Nenhum fornecedor'} action={!suppliers.length && <Button onClick={() => setEditing(blankSupplier())}>Cadastrar fornecedor</Button>} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => {
            const e = exp.get(s.id);
            const avg = ratingAvg(s.ratings);
            const url = safeUrl(s.website);
            return (
              <Card key={s.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{s.name}</div>
                    <div className="text-faint flex flex-wrap items-center gap-x-2 text-xs">
                      {s.document && <span>{s.document}</span>}
                      {url && (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand inline-flex items-center gap-1 hover:underline">
                          <ExternalLink size={11} /> {new URL(url).hostname.replace(/^www\./, '')}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0">
                    <button className="text-muted rounded-lg p-1.5 hover:bg-hover" onClick={() => setEditing(s)} title="Editar e avaliar">
                      <Pencil size={15} />
                    </button>
                    {can('admin') && (
                      <button className="text-muted rounded-lg p-1.5 hover:bg-hover hover:text-rose-500" onClick={() => remove(s)} title="Excluir">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {s.category && <Badge tone="violet">{s.category}</Badge>}
                  {avg > 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <Stars value={Math.round(avg * 2) / 2} size={14} /> <b className="tabular-nums">{num(avg, 1)}</b>
                    </span>
                  ) : (
                    <button className="text-faint text-xs hover:underline" onClick={() => setEditing(s)}>
                      sem avaliação — avaliar
                    </button>
                  )}
                </div>

                {avg > 0 && (
                  <div className="text-muted mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {CRITERIA.map((c) => (
                      <div key={c.key} className="flex items-center justify-between gap-2">
                        <span>{c.label}</span>
                        <Stars value={s.ratings[c.key]} size={11} />
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
                  <Metric label="Pontualidade" value={e?.onTime == null ? '—' : pct(e.onTime)} tone={e?.onTime == null ? undefined : e.onTime >= 0.9 ? 'green' : e.onTime >= 0.7 ? 'amber' : 'red'} />
                  <Metric label="Entrega completa" value={e?.fillRate == null ? '—' : pct(e.fillRate)} tone={e?.fillRate == null ? undefined : e.fillRate >= 0.98 ? 'green' : e.fillRate >= 0.9 ? 'amber' : 'red'} />
                  <Metric label="Prazo real" value={e?.avgLeadDays == null ? `${s.leadTimeDays}d*` : `${num(e.avgLeadDays)}d`} />
                  <Metric label="Pedidos" value={num(e?.orders ?? 0)} />
                  {finance && <Metric label="Comprado" value={brl(e?.totalBought ?? 0)} />}
                  <Metric label="Produtos" value={num(products.filter((p) => p.supplierId === s.id).length)} />
                </div>
                {s.notes && <p className="text-faint mt-3 line-clamp-2 text-xs italic">“{s.notes}”</p>}
              </Card>
            );
          })}
        </div>
      )}
      <p className="text-faint mt-3 text-xs">Pontualidade e entrega completa são calculadas pelos recebimentos. Prazo real = média de dias do pedido até a chegada (* = prazo informado, ainda sem histórico).</p>

      {editing && (
        <SupplierForm
          supplier={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={async (s) => {
            try {
              if (s.website && !safeUrl(s.website)) throw new Error('O link do site é inválido.');
              await saveSupplier({ ...s, website: safeUrl(s.website), category: s.category.trim() });
              toast('Fornecedor salvo');
              setEditing(null);
            } catch (e) {
              toast(errMsg(e), 'error');
            }
          }}
          isNew={!suppliers.some((x) => x.id === editing.id)}
        />
      )}
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' | 'red' }) {
  return (
    <div>
      <div className="text-faint">{label}</div>
      <div className={cx('font-medium tabular-nums', tone === 'green' && 'text-emerald-600', tone === 'amber' && 'text-amber-600', tone === 'red' && 'text-rose-600')}>{value}</div>
    </div>
  );
}

function SupplierForm({ supplier, categories, isNew, onClose, onSave }: { supplier: Supplier; categories: string[]; isNew: boolean; onClose: () => void; onSave: (s: Supplier) => void }) {
  const [s, setS] = useState<Supplier>({ ...supplier, ratings: { ...supplier.ratings } });
  const avg = ratingAvg(s.ratings);
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Novo fornecedor' : s.name}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(s)}>Salvar</Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="grid grid-cols-2 gap-4 lg:col-span-3">
          <Field label="Nome *" className="col-span-2">
            <Input autoFocus value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
          </Field>
          <Field label="Categoria" hint="Pet, bike, doméstico… ou digite uma nova">
            <Input list="supplier-cats" value={s.category} onChange={(e) => setS({ ...s, category: e.target.value })} placeholder="Ex.: Pet" />
            <datalist id="supplier-cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="CNPJ/CPF">
            <Input value={s.document} onChange={(e) => setS({ ...s, document: e.target.value })} />
          </Field>
          <Field label="Contato">
            <Input value={s.contact} onChange={(e) => setS({ ...s, contact: e.target.value })} />
          </Field>
          <Field label="Telefone / WhatsApp">
            <Input value={s.phone} onChange={(e) => setS({ ...s, phone: e.target.value })} />
          </Field>
          <Field label="E-mail">
            <Input type="email" value={s.email} onChange={(e) => setS({ ...s, email: e.target.value })} />
          </Field>
          <Field label="Site" hint={s.website && !safeUrl(s.website) ? 'Link inválido' : 'Loja, catálogo ou portal B2B'}>
            <Input type="url" inputMode="url" placeholder="https://fornecedor.com.br" value={s.website} onChange={(e) => setS({ ...s, website: e.target.value })} />
          </Field>
          <Field label="Prazo de entrega (dias)">
            <Input type="number" min={0} value={s.leadTimeDays} onChange={(e) => setS({ ...s, leadTimeDays: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="Observações / experiência" className="col-span-2" hint="Ex.: pedido mínimo, condições, histórico de problemas">
            <textarea
              value={s.notes}
              onChange={(e) => setS({ ...s, notes: e.target.value })}
              rows={3}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15"
            />
          </Field>
        </div>

        <div className="rounded-2xl border border-line p-4 lg:col-span-2">
          <p className="text-sm font-semibold">Avaliação</p>
          <p className="text-faint mb-4 text-xs">Clique nas estrelas (clique de novo para limpar)</p>
          <div className="space-y-4">
            {CRITERIA.map((c) => (
              <div key={c.key}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{c.label}</span>
                  <Stars value={s.ratings[c.key]} onChange={(v) => setS({ ...s, ratings: { ...s.ratings, [c.key]: v } })} size={20} />
                </div>
                <p className="text-faint text-xs">{c.hint}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-line pt-3">
            <span className="text-muted text-sm">Nota geral</span>
            <span className="text-2xl font-semibold tabular-nums">{avg ? num(avg, 1) : '—'}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
