import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Camera, ClipboardCheck, Minus, Plus, RotateCcw, ScanBarcode, ShoppingBag, Trash2, Undo2 } from 'lucide-react';
import { useStore, type NewMovement } from '../lib/store';
import { beep } from '../lib/feedback';
import { brl, errMsg, num } from '../lib/format';
import type { Product } from '../lib/types';
import { CameraScanner } from '../components/CameraScanner';
import { ProductForm } from '../components/ProductForm';
import { Badge, Button, Card, CardTitle, Empty, Field, Input, Modal, PageHeader, Select, cx } from '../components/ui';
import { useToast } from '../components/toast';

type Mode = 'entrada' | 'saida' | 'venda' | 'devolucao' | 'conferencia';

const MODES: { value: Mode; label: string; icon: typeof ArrowDownToLine; hint: string; color: string }[] = [
  { value: 'entrada', label: 'Entrada', icon: ArrowDownToLine, hint: 'Recebimento de mercadoria / compra', color: 'text-emerald-500' },
  { value: 'saida', label: 'Saída', icon: ArrowUpFromLine, hint: 'Retirada, perda, uso interno, envio Full', color: 'text-rose-500' },
  { value: 'venda', label: 'Venda', icon: ShoppingBag, hint: 'Venda com loja vinculada (alimenta as métricas)', color: 'text-indigo-500' },
  { value: 'devolucao', label: 'Devolução', icon: Undo2, hint: 'Produto voltando ao estoque', color: 'text-amber-500' },
  { value: 'conferencia', label: 'Inventário', icon: ClipboardCheck, hint: 'Contagem física: compara e ajusta o saldo', color: 'text-sky-500' },
];

interface Line {
  productId: string;
  qty: number;
}

export default function Scan() {
  const { products, stores, findByCode, productById, addMovements, adjustStockTo, can } = useStore();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('entrada');
  const [storeId, setStoreId] = useState('');
  const [mult, setMult] = useState(1);
  const [code, setCode] = useState('');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [last, setLast] = useState<{ product: Product | null; code: string; at: number } | null>(null);
  const [camera, setCamera] = useState(false);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [zeroMissing, setZeroMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const focus = useCallback(() => setTimeout(() => inputRef.current?.focus(), 0), []);

  // Leitores USB/Bluetooth funcionam como teclado: mantemos o foco no campo de leitura
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (unknown || creating || confirm) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [unknown, creating, confirm]);

  useEffect(() => {
    if (!storeId && stores.length) setStoreId(stores[0].id);
  }, [stores, storeId]);

  const add = useCallback((productId: string, qty: number) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === productId);
      if (i < 0) return [{ productId, qty }, ...ls];
      const copy = [...ls];
      const updated = { ...copy[i], qty: copy[i].qty + qty };
      copy.splice(i, 1);
      return updated.qty > 0 ? [updated, ...copy] : copy;
    });
  }, []);

  const handleCode = useCallback(
    (raw: string) => {
      const c = raw.trim();
      if (!c) return;
      const p = findByCode(c);
      if (p && p.isKit && mode === 'conferencia') {
        beep('error');
        setLast({ product: null, code: `${c} (kit — conte os componentes)`, at: Date.now() });
        return;
      }
      if (!p) {
        beep('error');
        setLast({ product: null, code: c, at: Date.now() });
        setUnknown(c);
        setCamera(false);
        return;
      }
      beep('ok');
      add(p.id, mult);
      setLast({ product: p, code: c, at: Date.now() });
    },
    [findByCode, add, mult],
  );

  const totalUnits = lines.reduce((s, l) => s + l.qty, 0);
  const totalValue = lines.reduce((s, l) => {
    const p = productById.get(l.productId);
    return s + l.qty * (mode === 'venda' || mode === 'devolucao' ? p?.price ?? 0 : can('finance') ? p?.cost ?? 0 : 0);
  }, 0);

  const divergences = useMemo(() => {
    if (mode !== 'conferencia') return [];
    const counted = new Map(lines.map((l) => [l.productId, l.qty]));
    const ids = zeroMissing ? products.filter((p) => p.active && !p.isKit).map((p) => p.id) : [...counted.keys()].filter((id) => !productById.get(id)?.isKit);
    return ids
      .map((id) => {
        const p = productById.get(id)!;
        const c = counted.get(id) ?? 0;
        return { product: p, counted: c, diff: c - p.stock };
      })
      .filter((d) => d.diff !== 0);
  }, [mode, lines, zeroMissing, products, productById]);

  async function commit() {
    setBusy(true);
    try {
      if (mode === 'conferencia') {
        const n = await adjustStockTo(
          divergences.map((d) => ({ productId: d.product.id, target: d.counted })),
          note || `Inventário ${new Date().toLocaleDateString('pt-BR')}`,
          'bipagem',
        );
        toast(n ? `Inventário aplicado: ${n} ajuste(s)` : 'Inventário conferido: nenhuma divergência');
      } else {
        const r = ref || `BIP-${Date.now().toString(36).toUpperCase()}`;
        const sign = mode === 'entrada' || mode === 'devolucao' ? 1 : -1;
        const moves: NewMovement[] = lines.map((l) => {
          const p = productById.get(l.productId)!;
          return {
            productId: l.productId,
            type: mode,
            qty: sign * l.qty,
            unitPrice: mode === 'venda' || mode === 'devolucao' ? p.price : null,
            unitCost: p.cost,
            storeId: mode === 'venda' || mode === 'devolucao' ? storeId || null : null,
            ref: r,
            note,
            source: 'bipagem',
          };
        });
        await addMovements(moves);
        toast(`${MODES.find((m) => m.value === mode)!.label} registrada: ${num(totalUnits)} un em ${lines.length} produto(s)`);
      }
      beep('done');
      setLines([]);
      setRef('');
      setNote('');
      setConfirm(false);
      setLast(null);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
      focus();
    }
  }

  const negatives =
    mode === 'saida' || mode === 'venda'
      ? lines.filter((l) => !productById.get(l.productId)?.isKit && (productById.get(l.productId)?.stock ?? 0) - l.qty < 0)
      : [];
  const current = MODES.find((m) => m.value === mode)!;

  return (
    <>
      <PageHeader title="Bipagem" subtitle="Use um leitor USB/Bluetooth, a câmera do celular ou digite o código e tecle Enter." />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => {
              if (lines.length && m.value !== mode && !window.confirm('Trocar o modo mantém os itens bipados. Continuar?')) return;
              setMode(m.value);
              focus();
            }}
            className={cx(
              'card flex items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-medium transition',
              mode === m.value ? 'ring-brand border-transparent ring-2' : 'hover:bg-hover',
            )}
          >
            <m.icon size={18} className={m.color} />
            {m.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <p className="text-muted mb-3 text-xs">{current.hint}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCode(code);
                setCode('');
              }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <ScanBarcode size={18} className="text-faint absolute top-1/2 left-3 -translate-y-1/2" />
                <Input
                  ref={inputRef}
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Bipe ou digite o código…"
                  className="h-12 pl-10 text-base"
                  autoComplete="off"
                  enterKeyHint="go"
                />
              </div>
              <Button size="lg" variant="secondary" onClick={() => setCamera((c) => !c)} aria-label="Câmera" title="Ler com a câmera">
                <Camera size={20} />
              </Button>
            </form>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Quantidade por bipe">
                <Input type="number" min={1} value={mult} onChange={(e) => setMult(Math.max(1, Math.round(Number(e.target.value) || 1)))} />
              </Field>
              {(mode === 'venda' || mode === 'devolucao') && (
                <Field label="Loja">
                  <Select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                    <option value="">Sem loja</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {mode !== 'conferencia' && (
                <Field label={mode === 'venda' ? 'Nº do pedido' : 'Referência (NF, pedido…)'}>
                  <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="opcional" />
                </Field>
              )}
              {mode === 'conferencia' && (
                <label className="col-span-2 flex items-start gap-2 text-xs">
                  <input type="checkbox" className="accent-brand mt-0.5" checked={zeroMissing} onChange={(e) => setZeroMissing(e.target.checked)} />
                  <span>
                    <b>Inventário completo</b>: produtos não bipados serão considerados com estoque <b>zero</b>. Deixe desmarcado para conferir só os itens bipados.
                  </span>
                </label>
              )}
            </div>

            {camera && (
              <div className="mt-4">
                <CameraScanner onResult={handleCode} onClose={() => setCamera(false)} />
              </div>
            )}
          </Card>

          {last && (
            <Card className={cx('pop', last.product ? '' : 'border-rose-500/50')} key={last.at}>
              {last.product ? (
                <div className="flex items-center gap-3">
                  {last.product.imageUrl ? (
                    <img src={last.product.imageUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
                  ) : (
                    <div className="bg-brand/10 text-brand flex h-14 w-14 items-center justify-center rounded-xl">
                      <ScanBarcode size={22} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{last.product.name}</div>
                    <div className="text-muted text-xs">
                      {last.product.sku} · saldo atual {last.product.stock} {last.product.location && `· ${last.product.location}`}
                    </div>
                  </div>
                  <Badge tone="green">+{mult}</Badge>
                </div>
              ) : (
                <div className="text-sm text-rose-600">
                  Código <b>{last.code}</b> não encontrado.
                </div>
              )}
            </Card>
          )}
        </div>

        <Card className="lg:col-span-3">
          <CardTitle
            hint={`${lines.length} produto(s) · ${num(totalUnits)} unidade(s)${mode !== 'conferencia' ? ` · ${brl(totalValue)}` : ''}`}
            action={
              lines.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => window.confirm('Limpar todos os itens bipados?') && setLines([])}>
                  <RotateCcw size={14} /> Limpar
                </Button>
              )
            }
          >
            {mode === 'conferencia' ? 'Itens contados' : 'Itens desta operação'}
          </CardTitle>

          {lines.length === 0 ? (
            <Empty icon={<ScanBarcode size={36} />} title="Nenhum item bipado" text="Os produtos aparecem aqui conforme você bipa. Bipar de novo soma a quantidade." />
          ) : (
            <ul className="divide-y divide-line">
              {lines.map((l) => {
                const p = productById.get(l.productId);
                if (!p) return null;
                const after = p.isKit ? 0 : mode === 'conferencia' ? l.qty : p.stock + (mode === 'entrada' || mode === 'devolucao' ? l.qty : -l.qty);
                return (
                  <li key={l.productId} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="text-faint text-xs">
                        {p.isKit ? <>{p.sku} · kit: baixa {p.kitItems.length} componente(s)</> : <>{p.sku} · saldo {p.stock} → <span className={after < 0 ? 'text-rose-500' : ''}>{after}</span></>}
                        {mode === 'conferencia' && after !== p.stock && <span className="ml-1 text-amber-600">(dif. {after - p.stock > 0 ? '+' : ''}{after - p.stock})</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button className="rounded-lg p-1.5 hover:bg-hover" onClick={() => add(p.id, -1)} aria-label="Diminuir">
                        <Minus size={14} />
                      </button>
                      <input
                        className="h-8 w-14 rounded-lg border border-line bg-surface text-center text-sm tabular-nums"
                        value={l.qty}
                        inputMode="numeric"
                        onChange={(e) => {
                          const v = Math.max(0, Math.round(Number(e.target.value) || 0));
                          setLines((ls) => ls.map((x) => (x.productId === p.id ? { ...x, qty: v } : x)).filter((x) => x.qty > 0 || x.productId === p.id));
                        }}
                        onBlur={() => setLines((ls) => ls.filter((x) => x.qty > 0))}
                      />
                      <button className="rounded-lg p-1.5 hover:bg-hover" onClick={() => add(p.id, 1)} aria-label="Aumentar">
                        <Plus size={14} />
                      </button>
                      <button className="text-faint rounded-lg p-1.5 hover:bg-hover hover:text-rose-500" onClick={() => setLines((ls) => ls.filter((x) => x.productId !== p.id))} aria-label="Remover">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {(lines.length > 0 || (mode === 'conferencia' && zeroMissing)) && (
            <div className="mt-4 space-y-3 border-t border-line pt-4">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Observação (opcional)" />
              <Button size="lg" className="w-full" onClick={() => setConfirm(true)}>
                {mode === 'conferencia' ? 'Revisar divergências' : `Confirmar ${current.label.toLowerCase()}`}
              </Button>
            </div>
          )}
        </Card>
      </div>

      {/* Código desconhecido */}
      <Modal
        open={!!unknown}
        onClose={() => {
          setUnknown(null);
          focus();
        }}
        title="Código não cadastrado"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setUnknown(null);
                focus();
              }}
            >
              Ignorar
            </Button>
            {can('manage') && (
              <Button
                onClick={() => {
                  setCreating(unknown);
                  setUnknown(null);
                }}
              >
                Cadastrar produto
              </Button>
            )}
          </>
        }
      >
        <p className="text-sm">
          O código <b className="font-mono">{unknown}</b> não pertence a nenhum produto (EAN ou SKU).{can('manage') ? ' Deseja cadastrá-lo agora?' : ' Peça a um gestor para cadastrá-lo.'}
        </p>
      </Modal>

      <ProductForm
        open={!!creating}
        onClose={() => {
          setCreating(null);
          focus();
        }}
        preset={creating ? (/^\d{8,14}$/.test(creating) ? { ean: creating } : { sku: creating }) : undefined}
        onSaved={(p) => {
          add(p.id, mult);
          setLast({ product: p, code: p.ean || p.sku, at: Date.now() });
        }}
      />

      {/* Confirmação */}
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={mode === 'conferencia' ? 'Divergências do inventário' : `Confirmar ${current.label.toLowerCase()}`}
        wide={mode === 'conferencia'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Voltar
            </Button>
            <Button onClick={commit} disabled={busy}>
              {busy ? 'Salvando…' : mode === 'conferencia' ? `Aplicar ${divergences.length} ajuste(s)` : 'Confirmar'}
            </Button>
          </>
        }
      >
        {mode === 'conferencia' ? (
          divergences.length ? (
            <div className="-mx-3 overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="text-right">Sistema</th>
                    <th className="text-right">Contado</th>
                    <th className="text-right">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {divergences.map((d) => (
                    <tr key={d.product.id}>
                      <td className="max-w-60 truncate">{d.product.name}</td>
                      <td className="text-right tabular-nums">{d.product.stock}</td>
                      <td className="text-right tabular-nums">{d.counted}</td>
                      <td className={cx('text-right font-medium tabular-nums', d.diff > 0 ? 'text-emerald-600' : 'text-rose-600')}>
                        {d.diff > 0 ? '+' : ''}
                        {d.diff}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm">Nenhuma divergência: a contagem bate com o sistema. ✅</p>
          )
        ) : (
          <div className="space-y-2 text-sm">
            <p>
              <b>{num(totalUnits)}</b> unidade(s) em <b>{lines.length}</b> produto(s)
              {mode === 'venda' && <> · total {brl(totalValue)}</>}
              {(mode === 'venda' || mode === 'devolucao') && <> · loja: {stores.find((s) => s.id === storeId)?.name ?? 'sem loja'}</>}
            </p>
            {negatives.length > 0 && (
              <p className="rounded-xl bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                Atenção: {negatives.length} produto(s) ficarão com saldo negativo. Confira se o estoque está correto.
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
