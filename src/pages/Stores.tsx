import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Pencil, Plus, Store as StoreIcon, Trash2 } from 'lucide-react';
import { useStore } from '../lib/store';
import { computeMetrics } from '../lib/metrics';
import { brl, compactBrl, errMsg, num, pct, shortDay, uid } from '../lib/format';
import { CHANNELS, STORE_COLORS, type Store } from '../lib/types';
import { Badge, Button, Card, CardTitle, Empty, Field, Input, Modal, PageHeader, Segmented, Select, cx } from '../components/ui';
import { useToast } from '../components/toast';

export default function Stores() {
  const { products, stores, movements, deleteStore } = useStore();
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [editing, setEditing] = useState<Store | null>(null);
  const [creating, setCreating] = useState(false);
  const m = useMemo(() => computeMetrics(products, stores, movements, { days }), [products, stores, movements, days]);
  const statById = new Map(m.byStore.map((s) => [s.storeId, s]));

  async function remove(s: Store) {
    if (!window.confirm(`Excluir a loja "${s.name}"? As vendas ficam no histórico como "sem loja".`)) return;
    try {
      await deleteStore(s.id);
      toast('Loja excluída');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  const compare = m.byStore.map((s) => ({ name: s.name, Faturamento: s.revenue, color: s.color }));

  return (
    <>
      <PageHeader
        title="Lojas"
        subtitle="Métricas por canal de venda"
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
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> Nova loja
            </Button>
          </>
        }
      />

      {stores.length === 0 ? (
        <Card>
          <Empty
            icon={<StoreIcon size={36} />}
            title="Nenhuma loja cadastrada"
            text="Cadastre suas lojas (Shopee, Mercado Livre, Amazon, loja física…). Na importação de pedidos do UpSeller, as lojas são criadas automaticamente."
            action={<Button onClick={() => setCreating(true)}>Cadastrar loja</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {stores.map((s) => {
              const st = statById.get(s.id);
              const series = m.daily.map((d) => ({ date: d.date, v: (d[s.id] as number) ?? 0 }));
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
                          {s.channel} {!s.active && <Badge>inativa</Badge>}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0">
                      <button className="text-muted rounded-lg p-1.5 hover:bg-hover" onClick={() => setEditing(s)} title="Editar">
                        <Pencil size={15} />
                      </button>
                      <button className="text-muted rounded-lg p-1.5 hover:bg-hover hover:text-rose-500" onClick={() => remove(s)} title="Excluir">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <Stat label="Faturamento" value={brl(st?.revenue ?? 0)} />
                    <Stat label="Participação" value={pct(st?.share ?? 0)} />
                    <Stat label="Pedidos" value={num(st?.orders ?? 0)} />
                    <Stat label="Ticket médio" value={brl(st?.ticket ?? 0)} />
                    <Stat label="Unidades" value={num(st?.units ?? 0)} />
                    <Stat label="Margem bruta" value={pct(st?.margin ?? 0)} />
                  </div>

                  <div className="mt-3 h-16">
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
              <CardTitle hint="Faturamento no período">Comparativo entre lojas</CardTitle>
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={compare} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => compactBrl(v)} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v: number) => brl(v)} cursor={{ fill: 'var(--hover)' }} />
                    <Bar dataKey="Faturamento" radius={[0, 6, 6, 0]} maxBarSize={28}>
                      {compare.map((c, i) => (
                        <Cell key={i} fill={c.color} />
                      ))}
                    </Bar>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-faint text-xs">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

function StoreForm({ open, onClose, store }: { open: boolean; onClose: () => void; store: Store | null }) {
  const { saveStore, stores } = useStore();
  const toast = useToast();
  const [s, setS] = useState<Store | null>(null);

  useEffect(() => {
    if (!open) return setS(null);
    setS(store ? { ...store } : { id: uid(), name: '', channel: 'Shopee', color: STORE_COLORS[stores.length % STORE_COLORS.length], active: true, createdAt: new Date().toISOString() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, store]);

  if (!open || !s) return null;

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
          <Select value={s.channel} onChange={(e) => setS({ ...s, channel: e.target.value })}>
            {CHANNELS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Cor">
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
