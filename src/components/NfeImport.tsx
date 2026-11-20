import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileCode2, Sparkles } from 'lucide-react';
import { blankProduct, useStore } from '../lib/store';
import { brl, errMsg, norm, num, uid } from '../lib/format';
import { formatDoc, itemLandedTotal, onlyDigits, parseNfe, suggestFactor, type Nfe, type NfeItem } from '../lib/nfe';
import { beep } from '../lib/feedback';
import type { Product, Purchase, Supplier } from '../lib/types';
import { ProductPicker } from './ProductPicker';
import { Badge, Button, Field, Input, Modal, Select, cx } from './ui';
import { useToast } from './toast';

type Mode = 'match' | 'create' | 'skip';
interface Line {
  item: NfeItem;
  mode: Mode;
  productId: string | null;
  factor: number;
  how: string;
}

export function NfeImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { products, suppliers, purchases, productById, findByCode, saveSupplier, saveProducts, receivePurchase, nextPurchaseNumber } = useStore();
  const toast = useToast();
  const [nfe, setNfe] = useState<Nfe | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [linkPo, setLinkPo] = useState('');
  const [includeTaxes, setIncludeTaxes] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ po: string; created: Product[]; units: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setNfe(null);
    setLines([]);
    setSupplierId('');
    setLinkPo('');
    setError('');
    setDone(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  async function onFile(f: File | undefined) {
    if (!f) return;
    reset();
    try {
      if (/\.pdf$/i.test(f.name)) throw new Error('Este é o PDF (DANFE). Para leitura exata, use o arquivo XML da nota — o fornecedor envia junto por e-mail.');
      const parsed = parseNfe(await f.text());
      const dup = purchases.find((p) => parsed.key && p.invoiceKey === parsed.key);
      if (dup) throw new Error(`Esta NF-e já foi lançada no pedido ${dup.number}.`);

      const sup = suppliers.find((s) => onlyDigits(s.document) && onlyDigits(s.document) === onlyDigits(parsed.supplier.document));
      const memory = sup?.productCodes ?? {};
      const usable = (p: Product | undefined) => (p && !p.isKit ? p : undefined);

      const matched: Line[] = parsed.items.map((it) => {
        const mem = memory[it.code];
        if (mem && usable(productById.get(mem.productId))) return { item: it, mode: 'match', productId: mem.productId, factor: mem.factor || 1, how: 'memória do fornecedor' };
        if (it.eanTrib && it.eanTrib !== it.ean) {
          const p = usable(findByCode(it.eanTrib));
          if (p) return { item: it, mode: 'match', productId: p.id, factor: suggestFactor(it), how: 'EAN da unidade' };
        }
        for (const code of [it.ean, it.eanTrib]) {
          const p = code ? usable(findByCode(code)) : undefined;
          if (p) return { item: it, mode: 'match', productId: p.id, factor: code === it.eanTrib ? suggestFactor(it) : 1, how: 'EAN' };
        }
        const bySku = it.code ? usable(findByCode(it.code)) : undefined;
        if (bySku) return { item: it, mode: 'match', productId: bySku.id, factor: 1, how: 'SKU' };
        return { item: it, mode: 'create', productId: null, factor: suggestFactor(it), how: '' };
      });

      setNfe(parsed);
      setLines(matched);
      setSupplierId(sup?.id ?? '');
      beep('ok');
    } catch (e) {
      beep('error');
      setError(errMsg(e));
    }
  }

  const calc = (l: Line) => {
    const units = Math.max(0, Math.round(l.item.qty * (l.factor || 1)));
    const total = itemLandedTotal(l.item, includeTaxes);
    return { units, total, unitCost: units ? Math.round((total / units) * 100) / 100 : 0 };
  };

  const openPos = useMemo(
    () => purchases.filter((p) => supplierId && p.supplierId === supplierId && ['rascunho', 'enviado', 'parcial'].includes(p.status)),
    [purchases, supplierId],
  );

  const active = lines.filter((l) => l.mode !== 'skip');
  const pending = lines.filter((l) => l.mode === 'match' && !l.productId).length;
  const totalUnits = active.reduce((s, l) => s + calc(l).units, 0);
  const totalCost = active.reduce((s, l) => s + calc(l).total, 0);

  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function confirm() {
    if (!nfe) return;
    if (pending) return toast(`Escolha o produto de ${pending} item(ns) ou marque como "criar" / "ignorar".`, 'error');
    if (!active.length) return toast('Nenhum item para lançar.', 'error');
    setBusy(true);
    try {
      // 1) fornecedor
      let supplier: Supplier | undefined = suppliers.find((s) => s.id === supplierId);
      if (!supplier) {
        supplier = {
          id: uid(),
          name: nfe.supplier.tradeName || nfe.supplier.name,
          document: formatDoc(nfe.supplier.document),
          contact: '',
          phone: nfe.supplier.phone,
          email: nfe.supplier.email,
          website: '',
          category: '',
          ratings: { quality: 0, delivery: 0, price: 0, service: 0 },
          leadTimeDays: 7,
          notes: nfe.supplier.tradeName ? `Razão social: ${nfe.supplier.name}` : '',
          productCodes: {},
          createdAt: new Date().toISOString(),
        };
      }

      // 2) produtos novos
      const usedSku = new Set(products.map((p) => norm(p.sku)));
      const usedEan = new Set(products.filter((p) => p.ean).map((p) => p.ean));
      const created: Product[] = [];
      const resolved = active.map((l) => {
        if (l.mode !== 'create') return { ...l, productId: l.productId! };
        let sku = (l.item.code || l.item.ean || `NF${nfe.number}-${l.item.nItem}`).trim();
        for (let n = 2; usedSku.has(norm(sku)); n++) sku = `${l.item.code || 'NF'}-${n}`;
        usedSku.add(norm(sku));
        const ean = [l.item.ean, l.item.eanTrib].find((e) => e && !usedEan.has(e) && (l.factor === 1 || e === l.item.eanTrib)) ?? '';
        if (ean) usedEan.add(ean);
        const p = blankProduct({ sku, ean, name: l.item.name, cost: calc(l).unitCost, supplierId: supplier!.id });
        created.push(p);
        return { ...l, productId: p.id };
      });

      // 3) memória: código do fornecedor → produto/fator (próximas notas casam sozinhas)
      const productCodes = { ...supplier.productCodes };
      for (const l of resolved) if (l.item.code) productCodes[l.item.code] = { productId: l.productId, factor: l.factor || 1 };
      supplier = { ...supplier, productCodes };
      await saveSupplier(supplier);
      if (created.length) await saveProducts(created);

      // 4) consolida por produto (a nota pode repetir o mesmo item)
      const agg = new Map<string, { qty: number; total: number }>();
      for (const l of resolved) {
        const c = calc(l);
        const a = agg.get(l.productId) ?? { qty: 0, total: 0 };
        a.qty += c.units;
        a.total += c.total;
        agg.set(l.productId, a);
      }
      const cost = (pid: string) => {
        const a = agg.get(pid)!;
        return a.qty ? Math.round((a.total / a.qty) * 100) / 100 : 0;
      };

      // 5) pedido de compra (existente ou novo) + recebimento
      const invoice = {
        invoiceNumber: nfe.series ? `${nfe.number}/${nfe.series}` : nfe.number,
        invoiceKey: nfe.key,
        invoiceDate: nfe.issuedAt.slice(0, 10),
        invoiceTotal: nfe.totals.invoice,
      };
      let po: Purchase;
      const existing = purchases.find((p) => p.id === linkPo);
      if (existing) {
        const items = existing.items.map((it) => (agg.has(it.productId) ? { ...it, unitCost: cost(it.productId) } : it));
        for (const pid of agg.keys()) if (!items.some((it) => it.productId === pid)) items.push({ productId: pid, qty: agg.get(pid)!.qty, received: 0, unitCost: cost(pid) });
        po = { ...existing, supplierId: supplier.id, items, ...invoice, notes: [existing.notes, `NF-e ${invoice.invoiceNumber}`].filter(Boolean).join(' · ') };
      } else {
        const now = new Date().toISOString();
        po = {
          id: uid(),
          number: nextPurchaseNumber(),
          supplierId: supplier.id,
          status: 'enviado',
          items: [...agg.entries()].map(([pid, a]) => ({ productId: pid, qty: a.qty, received: 0, unitCost: cost(pid) })),
          expectedAt: '',
          notes: `Lançado pela NF-e ${invoice.invoiceNumber}`,
          ...invoice,
          createdAt: now,
          updatedAt: now,
        };
      }
      await receivePurchase(
        po,
        [...agg.entries()].map(([productId, a]) => ({ productId, qty: a.qty })),
        `NF-e ${invoice.invoiceNumber} · ${supplier.name}`,
      );
      beep('done');
      setDone({ po: po.number, created, units: totalUnits });
      toast(`NF-e ${invoice.invoiceNumber} lançada no estoque`);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Importar NF-e de entrada"
      wide
      footer={
        done ? (
          <Button onClick={close}>Concluir</Button>
        ) : nfe ? (
          <>
            <span className="text-muted mr-auto self-center text-sm">
              {num(totalUnits)} un · custo {brl(totalCost)}
            </span>
            <Button variant="secondary" onClick={reset}>
              Outra nota
            </Button>
            <Button onClick={confirm} disabled={busy}>
              {busy ? 'Lançando…' : 'Lançar no estoque'}
            </Button>
          </>
        ) : undefined
      }
    >
      {done ? (
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-emerald-600">
            <CheckCircle2 size={18} /> Entrada de {num(done.units)} unidades registrada no pedido {done.po}.
          </p>
          <p className="text-muted">O custo médio de cada produto foi atualizado. Na próxima nota deste fornecedor, os itens serão reconhecidos automaticamente.</p>
          {done.created.length > 0 && (
            <div className="rounded-xl bg-amber-500/10 p-3">
              <p className="mb-1 font-medium text-amber-800 dark:text-amber-200">{done.created.length} produto(s) novo(s) criado(s) — defina o preço de venda:</p>
              <ul className="list-disc pl-5">
                {done.created.map((p) => (
                  <li key={p.id}>
                    <Link to={`/produtos/${p.id}`} className="hover:underline" onClick={close}>
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : !nfe ? (
        <>
          <div
            className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line p-10 text-center transition hover:bg-hover"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files[0]);
            }}
          >
            <FileCode2 className="text-brand" size={32} />
            <p className="font-medium">Arraste o XML da NF-e aqui</p>
            <p className="text-faint text-xs">ou clique para escolher · arquivo .xml que o fornecedor envia junto com a nota</p>
          </div>
          <input ref={fileRef} type="file" accept=".xml,text/xml,application/xml,.pdf" className="hidden" onChange={(e) => (void onFile(e.target.files?.[0]), (e.target.value = ''))} />
          {error && (
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
          <ul className="text-muted mt-4 space-y-1 text-xs">
            <li>
              <Sparkles size={12} className="mr-1 inline text-amber-500" />
              Reconhece os produtos pelo EAN, pelo código do fornecedor (e lembra para as próximas notas) ou pelo SKU.
            </li>
            <li>
              <Sparkles size={12} className="mr-1 inline text-amber-500" />
              Converte caixas em unidades quando a nota informa as duas (ex.: 2 CX = 24 UN).
            </li>
            <li>
              <Sparkles size={12} className="mr-1 inline text-amber-500" />
              Custo real por unidade: produto + frete + seguro + outras despesas − desconto (+ IPI e ICMS-ST).
            </li>
          </ul>
        </>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 rounded-xl bg-[var(--hover)] p-3 text-sm sm:grid-cols-4">
            <div>
              <div className="text-faint text-xs">NF-e</div>
              <div className="font-medium">
                {nfe.number}
                {nfe.series && `/${nfe.series}`}
              </div>
            </div>
            <div>
              <div className="text-faint text-xs">Emissão</div>
              <div className="font-medium">{nfe.issuedAt ? new Date(nfe.issuedAt).toLocaleDateString('pt-BR') : '—'}</div>
            </div>
            <div>
              <div className="text-faint text-xs">Valor da nota</div>
              <div className="font-medium">{brl(nfe.totals.invoice)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-faint text-xs">Emitente</div>
              <div className="truncate font-medium" title={nfe.supplier.name}>
                {nfe.supplier.tradeName || nfe.supplier.name}
              </div>
              <div className="text-faint text-xs">{formatDoc(nfe.supplier.document)}</div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Fornecedor" hint={supplierId ? 'Reconhecido pelo CNPJ' : 'Será cadastrado com os dados da nota'}>
              <Select value={supplierId} onChange={(e) => (setSupplierId(e.target.value), setLinkPo(''))}>
                <option value="">+ Novo: {nfe.supplier.tradeName || nfe.supplier.name}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Pedido de compra" hint={openPos.length ? 'Baixa o que estava pendente no pedido' : 'Um pedido novo será criado'}>
              <Select value={linkPo} onChange={(e) => setLinkPo(e.target.value)} disabled={!openPos.length}>
                <option value="">Criar novo pedido</option>
                {openPos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.number} · {p.items.length} itens
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-start gap-2 self-end rounded-xl border border-line p-3 text-xs">
              <input type="checkbox" className="accent-brand mt-0.5" checked={includeTaxes} onChange={(e) => setIncludeTaxes(e.target.checked)} />
              <span>
                <b>Somar IPI e ICMS-ST ao custo</b>
                <span className="text-faint block">Desmarque se você recupera esses impostos</span>
              </span>
            </label>
          </div>

          <div className="-mx-3 overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Item da nota</th>
                  <th>Produto no estoque</th>
                  <th className="text-right">Fator</th>
                  <th className="text-right">Unidades</th>
                  <th className="text-right">Custo unit.</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const c = calc(l);
                  const p = l.productId ? productById.get(l.productId) ?? null : null;
                  return (
                    <tr key={`${l.item.nItem}-${i}`} className={cx(l.mode === 'skip' && 'opacity-40')}>
                      <td className="max-w-64">
                        <div className="truncate font-medium" title={l.item.name}>
                          {l.item.name}
                        </div>
                        <div className="text-faint text-xs">
                          {l.item.code} {l.item.ean && `· ${l.item.ean}`} · {num(l.item.qty, 2)} {l.item.unit} × {brl(l.item.unitPrice)}
                        </div>
                      </td>
                      <td className="min-w-64">
                        <div className="flex items-center gap-2">
                          <Select value={l.mode} onChange={(e) => update(i, { mode: e.target.value as Mode, productId: e.target.value === 'match' ? l.productId : l.mode === 'match' ? l.productId : null })} className="h-8 w-28 text-xs">
                            <option value="match">Vincular</option>
                            <option value="create">Criar novo</option>
                            <option value="skip">Ignorar</option>
                          </Select>
                          {l.mode === 'match' && (
                            <div className="min-w-0 flex-1">
                              <ProductPicker value={p} onChange={(x) => update(i, { productId: x?.id ?? null, how: 'manual' })} filter={(x) => !x.isKit} placeholder="Buscar produto…" />
                            </div>
                          )}
                          {l.mode === 'create' && <span className="text-muted truncate text-xs">SKU {l.item.code || '(gerado)'}</span>}
                        </div>
                        {l.mode === 'match' && l.how && l.how !== 'manual' && <Badge tone="green" className="mt-1">por {l.how}</Badge>}
                      </td>
                      <td className="text-right">
                        <Input
                          type="number"
                          min={1}
                          className="h-8 w-16 text-right"
                          value={l.factor}
                          title="Unidades por unidade da nota (ex.: caixa com 12 = 12)"
                          onChange={(e) => update(i, { factor: Math.max(1, Number(e.target.value) || 1) })}
                          disabled={l.mode === 'skip'}
                        />
                      </td>
                      <td className="text-right font-medium tabular-nums">{l.mode === 'skip' ? '—' : num(c.units)}</td>
                      <td className="text-right tabular-nums">{l.mode === 'skip' ? '—' : brl(c.unitCost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(nfe.totals.freight > 0 || nfe.totals.ipi > 0 || nfe.totals.st > 0 || nfe.totals.discount > 0) && (
            <p className="text-faint text-xs">
              Rateado no custo: frete {brl(nfe.totals.freight)} · desconto {brl(nfe.totals.discount)}
              {includeTaxes && ` · IPI ${brl(nfe.totals.ipi)} · ICMS-ST ${brl(nfe.totals.st)}`}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
