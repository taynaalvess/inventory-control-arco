import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Pencil, Plus, Store as StoreIcon, Target, Trash2 } from 'lucide-react';
import { blankStore, useStore } from '../lib/store';
import { computeMetrics, monthRevenueByStore } from '../lib/metrics';
import { brl, compactBrl, errMsg, num, pct, shortDay } from '../lib/format';
import { CHANNEL_DEFAULT_FEES, CHANNELS, STORE_COLORS, type Store } from '../lib/types';
import { Badge, Button, Card, CardTitle, Empty, Field, Input, Modal, PageHeader, Segmented, Select, cx } from '../components/ui';
import { useToast } from '../components/toast';

export default function Stores() {
  const { products, stores, movements, deleteStore, can } = useStore();
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [editing, setEditing] = useState<Store | null>(null);
  const [creating, setCreating] = useState(false);
  const m = useMemo(() => computeMetrics(products, stores, movements, { days }), [products, stores, movements, days]);
  const month = useMemo(() => monthRevenueByStore(movements, products), [movements, products]);
  const statById = new Map(m.byStore.map((s) => [s.storeId, s]));
  const manage = can('manage');

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthElapsed = now.getDate() / daysInMonth;

  async function remove(s: Store) {
    if (!window.confirm(`Excluir a loja "${s.name}"? As vendas ficam no histórico como "sem loja".`)) return;
    try {
      await deleteStore(s.id);
      toast('Loja excluída');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  const compare = m.byStore.map((s) => ({ name: s.name, Faturamento: s.revenue, Lucro: s.netProfit, color: s.color }));

  return (
    <>
      <PageHeader
        title="Lojas"
        subtitle="Faturamento, taxas, lucro líquido e metas por canal"
        actions={
          <>
            <Segmented
              value={days}
              onChange={setDays}
              options={[
                { value: 7, label: '7d' },
                { value: 30, label: '30d' },
                { value: 90, label: '90d' },
                { value: 365, label: '12m' },
              ]}
            />
            {manage && (
              <Button onClick={() => setCreating(true)}>
                <Plus size={16} /> Nova loja
              </Button>
            )}
          </>
        }
      />

      {stores.length === 0 ? (
        <Card>
          <Empty
            icon={<StoreIcon size={36} />}
            title="Nenhuma loja cadastrada"
            text="Cadastre suas lojas (Shopee, Mercado Livre, Amazon, loja física…). Na importação de pedidos do UpSeller, elas são criadas automaticamente."
            action={manage && <Button onClick={() => setCreating(true)}>Cadastrar loja</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {stores.map((s) => {
              const st = statById.get(s.id);
              const series = m.daily.map((d) => ({ date: d.date, v: (d[s.id] as number) ?? 0 }));
              const mRev = month.get(s.id) ?? 0;
              const goalPct = s.monthlyGoal ? mRev / s.monthlyGoal : 0;
              const onTrack = goalPct >= monthElapsed;
              return (
                <Card key={s.id} className={cx(!s.active && 'opacity-60')}>
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: s.color }}>
                        <StoreIcon size={18} />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{s.name}</div>
                        <div className="text-faint text-xs">
                          {s.channel} · {num(s.commissionPct, 1)}% + {brl(s.fixedFee)}/pedido {!s.active && <Badge>inativa</Badge>}
                        </div>
                      </div>
                    </div>
                    {manage && (
                      <div className="flex shrink-0">
                        <button className="text-muted rounded-lg p-1.5 hover:bg-hover" onClick={() => setEditing(s)} title="Editar">
                          <Pencil size={15} />
                        </button>
                        {can('admin') && (
                          <button className="text-muted rounded-lg p-1.5 hover:bg-hover hover:text-rose-500" onClick={() => remove(s)} title="Excluir">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <Stat label="Faturamento" value={brl(st?.revenue ?? 0)} />
                    <Stat label="Lucro líquido" value={brl(st?.netProfit ?? 0)} tone={(st?.netProfit ?? 0) < 0 ? 'red' : undefined} />
                    <Stat label="Pedidos" value={num(st?.orders ?? 0)} />
                    <Stat label="Ticket médio" value={brl(st?.ticket ?? 0)} />
                    <Stat label="Taxas pagas" value={brl(st?.fees ?? 0)} />
                    <Stat label="Margem líquida" value={pct(st?.netMargin ?? 0)} />
                  </div>

                  {s.monthlyGoal > 0 && (
                    <div className="mt-4">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-muted inline-flex items-center gap-1">
                          <Target size={12} /> Meta do mês
                        </span>
                        <span className={cx('font-medium', onTrack ? 'text-emerald-600' : 'text-amber-600')}>
                          {pct(goalPct)} de {compactBrl(s.monthlyGoal)}
                        </span>
                      </div>
                      <div className="relative h-2 overflow-hidden rounded-full bg-[var(--hover)]">
                        <div className={cx('h-full rounded-full', onTrack ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: `${Math.min(100, goalPct * 100)}%` }} />
                        <div className="absolute inset-y-0 w-0.5 bg-[var(--text)] opacity-40" style={{ left: `${monthElapsed * 100}%` }} title="Esperado até hoje" />
                      </div>
                      <p className="text-faint mt-1 text-xs">
                        {onTrack ? 'No ritmo' : 'Abaixo do ritmo'} · projeção {compactBrl(monthElapsed ? mRev / monthElapsed : 0)}
                      </p>
                    </div>
                  )}

                  <div className="mt-3 h-14">
                    <ResponsiveContainer>
                      <LineChart data={series}>
                        <Tooltip labelFormatter={(l) => shortDay(String(series[Number(l)]?.date ?? ''))} formatter={(v: number) => [brl(v), 'Faturamento']} />
                        <Line type="monotone" dataKey="v" stroke={s.color} strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-faint mt-2 truncate text-xs">Mais vendido: {st?.topProduct?.name ?? '—'}</p>
                </Card>
              );
            })}
          </div>

          {compare.length > 1 && (
            <Card className="mt-4">
              <CardTitle hint="Faturamento × lucro líquido no período">Comparativo entre lojas</CardTitle>
              <div className="h-72">
                <ResponsiveContainer>
                  <BarChart data={compare} margin={{ left: 0, right: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} />
                    <YAxis tickFormatter={(v) => compactBrl(v)} width={64} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v: number) => brl(v)} cursor={{ fill: 'var(--hover)' }} />
                    <Bar dataKey="Faturamento" radius={[6, 6, 0, 0]} maxBarSize={40}>
                      {compare.map((c, i) => (
                        <Cell key={i} fill={c.color} />
                      ))}
                    </Bar>
                    <Bar dataKey="Lucro" radius={[6, 6, 0, 0]} maxBarSize={40} fill="#10b981" fillOpacity={0.75} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      )}

      <StoreForm open={creating || !!editing} store={editing} onClose={() => (setCreating(false), setEditing(null))} />
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'red' }) {
  return (
    <div>
      <div className="text-faint text-xs">{label}</div>
      <div className={cx('font-medium tabular-nums', tone === 'red' && 'text-rose-600')}>{value}</div>
    </div>
  );
}

function StoreForm({ open, onClose, store }: { open: boolean; onClose: () => void; store: Store | null }) {
  const { saveStore, stores } = useStore();
  const toast = useToast();
  const [s, setS] = useState<Store | null>(null);

  useEffect(() => {
    if (!open) return setS(null);
    setS(store ? { ...store } : blankStore({ channel: 'Shopee', color: STORE_COLORS[stores.length % STORE_COLORS.length], ...CHANNEL_DEFAULT_FEES.Shopee }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, store]);

  if (!open || !s) return null;
  const num0 = (v: string) => Math.max(0, Number(v.replace(',', '.')) || 0);

  async function submit() {
    try {
      await saveStore(s!);
      toast(store ? 'Loja atualizada' : 'Loja cadastrada');
      onClose();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={store ? 'Editar loja' : 'Nova loja'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit}>Salvar</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nome da loja" className="col-span-2" hint="Use o mesmo nome que aparece no UpSeller para casar a importação de pedidos">
          <Input autoFocus value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="Ex.: Shopee Arco" />
        </Field>
        <Field label="Canal">
          <Select
            value={s.channel}
            onChange={(e) => {
              const channel = e.target.value;
              const fees = !store ? CHANNEL_DEFAULT_FEES[channel] ?? { commissionPct: 0, fixedFee: 0 } : {};
              setS({ ...s, channel, ...fees });
            }}
          >
            {CHANNELS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Meta mensal (R$)">
          <Input type="number" min={0} step="100" value={s.monthlyGoal || ''} onChange={(e) => setS({ ...s, monthlyGoal: num0(e.target.value) })} placeholder="opcional" />
        </Field>
        <Field label="Comissão (%)" hint="Sobre o valor vendido">
          <Input type="number" min={0} max={100} step="0.1" value={s.commissionPct} onChange={(e) => setS({ ...s, commissionPct: Math.min(100, num0(e.target.value)) })} />
        </Field>
        <Field label="Taxa fixa por pedido (R$)">
          <Input type="number" min={0} step="0.01" value={s.fixedFee} onChange={(e) => setS({ ...s, fixedFee: num0(e.target.value) })} />
        </Field>
        <p className="text-faint col-span-2 -mt-2 text-xs">Valores sugeridos são referências aproximadas — confira as taxas reais da sua conta/categoria.</p>
        <Field label="Cor" className="col-span-2">
          <div className="flex flex-wrap gap-2 pt-1">
            {STORE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setS({ ...s, color: c })}
                className={cx('h-7 w-7 rounded-full ring-offset-2 ring-offset-[var(--surface)]', s.color === c && 'ring-2 ring-[var(--text)]')}
                style={{ background: c }}
                aria-label={c}
              />
            ))}
          </div>
        </Field>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-brand h-4 w-4" checked={s.active} onChange={(e) => setS({ ...s, active: e.target.checked })} />
          Loja ativa
        </label>
      </div>
    </Modal>
  );
}
