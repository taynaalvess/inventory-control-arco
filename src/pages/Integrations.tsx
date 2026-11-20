import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Github, KeyRound, RefreshCw, Upload, Zap } from 'lucide-react';
import { blankProduct, useStore, type NewMovement } from '../lib/store';
import { errMsg, norm, uid, dateTime } from '../lib/format';
import { CANCELLED, ORDER_FIELDS, PRODUCT_FIELDS, cell, guessChannel, guessMapping, parseDate, parseNum, readSheet, str, type FieldDef, type Mapping, type Sheet } from '../lib/importers';
import { fetchSyncRuns, type SyncRun } from '../lib/db/supabase';
import { STORE_COLORS, type Product, type Store } from '../lib/types';
import { Badge, Button, Card, CardTitle, Field, PageHeader, Segmented, Select, cx } from '../components/ui';
import { useToast } from '../components/toast';

type Kind = 'produtos' | 'pedidos';

interface Result {
  lines: string[];
  warnings: string[];
}

export default function Integrations() {
  const [tab, setTab] = useState<'planilha' | 'api'>('planilha');
  return (
    <>
      <PageHeader
        title="Integração UpSeller"
        subtitle="Traga produtos, estoque e pedidos das suas lojas para o painel"
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'planilha', label: 'Importar planilha' },
              { value: 'api', label: 'Sincronização automática (API)' },
            ]}
          />
        }
      />
      {tab === 'planilha' ? <SheetImport /> : <ApiSync />}
    </>
  );
}

/* ------------------------------------------------------------------ */

function SheetImport() {
  const store = useStore();
  const { products, stores, movements, findByCode, saveProducts, saveStores, addMovements } = store;
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('produtos');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Mapping>({});
  const [updateStock, setUpdateStock] = useState(true);
  const [affectsStock, setAffectsStock] = useState(true);
  const [skipCancelled, setSkipCancelled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fields = kind === 'produtos' ? PRODUCT_FIELDS : ORDER_FIELDS;

  useEffect(() => {
    if (sheet) setMapping(guessMapping(sheet.headers, fields));
  }, [kind, sheet, fields]);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setResult(null);
    try {
      const s = await readSheet(f);
      setSheet(s);
      setFileName(f.name);
      // detecção automática do tipo de planilha
      const h = s.headers.map(norm).join(' ');
      if (/pedido|order/.test(h)) setKind('pedidos');
      else setKind('produtos');
    } catch (e) {
      toast(`Não consegui ler o arquivo: ${errMsg(e)}`, 'error');
    }
  }

  const missing = fields.filter((f) => f.required && !mapping[f.key]);

  async function runProducts(): Promise<Result> {
    const bySku = new Map(products.map((p) => [norm(p.sku), p]));
    const usedEan = new Map(products.filter((p) => p.ean).map((p) => [norm(p.ean), p.id]));
    const toSave: Product[] = [];
    const moves: NewMovement[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();
    let created = 0,
      updated = 0;

    sheet!.rows.forEach((row, i) => {
      const sku = str(cell(row, mapping, 'sku'));
      if (!sku) return;
      const k = norm(sku);
      if (seen.has(k)) return warnings.push(`Linha ${i + 2}: SKU ${sku} repetido na planilha (ignorado)`);
      seen.add(k);
      const existing = bySku.get(k);
      const p: Product = existing ? { ...existing } : blankProduct({ sku, name: sku });
      const name = str(cell(row, mapping, 'name'));
      if (name) p.name = name;
      const ean = str(cell(row, mapping, 'ean')).replace(/\D/g, '');
      if (ean) {
        const owner = usedEan.get(ean);
        if (owner && owner !== p.id) warnings.push(`SKU ${sku}: EAN ${ean} já pertence a outro produto (não aplicado)`);
        else {
          p.ean = ean;
          usedEan.set(ean, p.id);
        }
      }
      for (const key of ['price', 'cost'] as const) {
        const v = parseNum(cell(row, mapping, key));
        if (v !== null) p[key] = v;
      }
      const min = parseNum(cell(row, mapping, 'minStock'));
      if (min !== null) p.minStock = Math.round(min);
      for (const key of ['category', 'brand', 'location'] as const) {
        const v = str(cell(row, mapping, key));
        if (v) p[key] = v;
      }
      toSave.push(p);
      existing ? updated++ : created++;

      if (updateStock && mapping.stock) {
        const q = parseNum(cell(row, mapping, 'stock'));
        if (q !== null) {
          const d = Math.round(q) - (existing?.stock ?? 0);
          if (d) moves.push({ productId: p.id, type: 'ajuste', qty: d, unitCost: p.cost, note: `Importação UpSeller (${fileName})`, source: 'importacao' });
        }
      }
    });

    await saveProducts(toSave);
    await addMovements(moves);
    return {
      lines: [`${created} produto(s) criado(s)`, `${updated} produto(s) atualizado(s)`, `${moves.length} saldo(s) ajustado(s)`],
      warnings,
    };
  }

  async function runOrders(): Promise<Result> {
    const storeByName = new Map(stores.map((s) => [norm(s.name), s]));
    const newStores: Store[] = [];
    const existing = new Set(movements.filter((m) => m.type === 'venda').map((m) => `${m.ref}|${m.productId}`));
    const agg = new Map<string, NewMovement>();
    const unknown = new Set<string>();
    let cancelled = 0,
      duplicated = 0;
    const warnings: string[] = [];

    sheet!.rows.forEach((row) => {
      const orderId = str(cell(row, mapping, 'orderId'));
      const sku = str(cell(row, mapping, 'sku'));
      if (!orderId || !sku) return;
      if (skipCancelled && CANCELLED.test(str(cell(row, mapping, 'status')))) return void cancelled++;
      const p = findByCode(sku);
      if (!p) return void unknown.add(sku);
      const key = `${orderId}|${p.id}`;
      if (existing.has(key)) return void duplicated++;

      const qty = Math.round(parseNum(cell(row, mapping, 'qty')) ?? 1) || 1;
      const total = parseNum(cell(row, mapping, 'total'));
      const unit = parseNum(cell(row, mapping, 'unitPrice')) ?? (total !== null ? total / qty : null) ?? p.price;

      let storeId: string | null = null;
      const sName = str(cell(row, mapping, 'store'));
      if (sName) {
        let s = storeByName.get(norm(sName));
        if (!s) {
          s = { id: uid(), name: sName, channel: guessChannel(sName), color: STORE_COLORS[(stores.length + newStores.length) % STORE_COLORS.length], active: true, createdAt: new Date().toISOString() };
          storeByName.set(norm(sName), s);
          newStores.push(s);
        }
        storeId = s.id;
      }
      const date = parseDate(cell(row, mapping, 'date')) ?? new Date();

      const prev = agg.get(key);
      if (prev) {
        const totalUnits = -prev.qty + qty;
        prev.unitPrice = ((prev.unitPrice ?? 0) * -prev.qty + unit * qty) / totalUnits;
        prev.qty = -totalUnits;
      } else {
        agg.set(key, {
          productId: p.id,
          type: 'venda',
          qty: -qty,
          unitPrice: Math.round(unit * 100) / 100,
          unitCost: p.cost,
          storeId,
          ref: orderId,
          note: '',
          source: 'importacao',
          affectsStock,
          createdAt: date.toISOString(),
        });
      }
    });

    await saveStores(newStores);
    const moves = [...agg.values()];
    await addMovements(moves);
    const orders = new Set(moves.map((m) => m.ref)).size;
    if (unknown.size) warnings.push(`${unknown.size} SKU(s) não cadastrados (importe a planilha de produtos antes): ${[...unknown].slice(0, 15).join(', ')}${unknown.size > 15 ? '…' : ''}`);
    return {
      lines: [
        `${orders} pedido(s) / ${moves.length} item(ns) importado(s)`,
        `${newStores.length} loja(s) criada(s)`,
        `${duplicated} item(ns) já importado(s) antes (ignorados)`,
        `${cancelled} item(ns) cancelado(s)/devolvido(s) ignorado(s)`,
      ],
      warnings,
    };
  }

  async function run() {
    setBusy(true);
    try {
      const r = kind === 'produtos' ? await runProducts() : await runOrders();
      setResult(r);
      toast('Importação concluída');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4">
        <Card>
          <CardTitle hint="Funciona com qualquer plano do UpSeller">Como exportar do UpSeller</CardTitle>
          <ol className="text-muted list-decimal space-y-2 pl-4 text-sm">
            <li>
              <b>Produtos/estoque:</b> no UpSeller, abra <i>Estoque → Lista de estoque</i> (ou <i>Produtos → SKU</i>) e use <i>Exportar</i>.
            </li>
            <li>
              <b>Pedidos:</b> em <i>Pedidos</i>, filtre o período e use <i>Exportar pedidos</i>.
            </li>
            <li>Arraste o arquivo (.xlsx ou .csv) aqui. As colunas são reconhecidas automaticamente e você pode ajustar.</li>
            <li>Importe <b>produtos antes</b> dos pedidos. Reimportar não duplica nada.</li>
          </ol>
        </Card>

        <Card>
          <div
            className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line p-8 text-center transition hover:bg-hover"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files[0]);
            }}
          >
            <Upload className="text-brand" size={28} />
            <p className="text-sm font-medium">{fileName || 'Clique ou arraste a planilha'}</p>
            <p className="text-faint text-xs">{sheet ? `${sheet.rows.length} linhas · aba "${sheet.sheetName}"` : '.xlsx, .xls ou .csv'}</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </Card>
      </div>

      <Card className="lg:col-span-2">
        {!sheet ? (
          <div className="text-muted flex h-full min-h-60 flex-col items-center justify-center gap-2 text-center text-sm">
            <FileSpreadsheet size={36} className="text-faint" />
            Selecione uma planilha para mapear as colunas.
          </div>
        ) : (
          <>
            <CardTitle
              hint="Confira se cada campo aponta para a coluna certa"
              action={
                <Segmented
                  value={kind}
                  onChange={(k) => {
                    setKind(k);
                    setResult(null);
                  }}
                  options={[
                    { value: 'produtos', label: 'Produtos/estoque' },
                    { value: 'pedidos', label: 'Pedidos/vendas' },
                  ]}
                />
              }
            >
              Mapeamento de colunas
            </CardTitle>

            <MappingGrid fields={fields} headers={sheet.headers} mapping={mapping} onChange={setMapping} />

            <div className="mt-4 space-y-2 rounded-xl bg-[var(--hover)] p-3 text-sm">
              {kind === 'produtos' ? (
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="accent-brand mt-1" checked={updateStock} onChange={(e) => setUpdateStock(e.target.checked)} disabled={!mapping.stock} />
                  <span>
                    <b>Igualar o saldo ao da planilha</b> — gera ajustes registrados no histórico.
                    {!mapping.stock && <span className="text-faint"> (mapeie a coluna de estoque)</span>}
                  </span>
                </label>
              ) : (
                <>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="accent-brand mt-1" checked={affectsStock} onChange={(e) => setAffectsStock(e.target.checked)} />
                    <span>
                      <b>Baixar estoque</b> com estas vendas. Desmarque se o saldo já vem atualizado pela importação de estoque do UpSeller (assim as vendas entram só nas métricas, sem baixa em dobro).
                    </span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="accent-brand mt-1" checked={skipCancelled} onChange={(e) => setSkipCancelled(e.target.checked)} />
                    <span>Ignorar pedidos cancelados, devolvidos ou não pagos (pela coluna de status)</span>
                  </label>
                </>
              )}
            </div>

            <Preview sheet={sheet} fields={fields} mapping={mapping} />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <span className="text-muted text-xs">{missing.length ? `Mapeie: ${missing.map((f) => f.label).join(', ')}` : `${sheet.rows.length} linhas prontas`}</span>
              <Button onClick={run} disabled={busy || missing.length > 0}>
                {busy ? 'Importando…' : `Importar ${kind}`}
              </Button>
            </div>

            {result && (
              <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 size={16} /> Importação concluída
                </div>
                <ul className="list-disc space-y-1 pl-5">
                  {result.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                {result.warnings.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-700 dark:text-amber-300">
                    {result.warnings.slice(0, 20).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                    {result.warnings.length > 20 && <li>… e mais {result.warnings.length - 20} aviso(s)</li>}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function MappingGrid({ fields, headers, mapping, onChange }: { fields: FieldDef[]; headers: string[]; mapping: Mapping; onChange: (m: Mapping) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`}>
          <Select
            value={mapping[f.key] ?? ''}
            onChange={(e) => onChange({ ...mapping, [f.key]: e.target.value })}
            className={cx(f.required && !mapping[f.key] && 'border-rose-400')}
          >
            <option value="">— não importar —</option>
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
        </Field>
      ))}
    </div>
  );
}

function Preview({ sheet, fields, mapping }: { sheet: Sheet; fields: FieldDef[]; mapping: Mapping }) {
  const cols = fields.filter((f) => mapping[f.key]);
  const rows = useMemo(() => sheet.rows.slice(0, 5), [sheet]);
  if (!cols.length) return null;
  return (
    <div className="mt-4">
      <p className="text-muted mb-2 text-xs font-medium">Prévia (5 primeiras linhas)</p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="data">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => {
                  const v = r[mapping[c.key]];
                  return (
                    <td key={c.key} className="max-w-48 truncate text-xs">
                      {v instanceof Date ? v.toLocaleString('pt-BR') : str(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ApiSync() {
  const { supabase, config } = useStore();
  const [runs, setRuns] = useState<SyncRun[] | null>(null);

  const load = async () => {
    if (supabase) setRuns(await fetchSyncRuns(supabase));
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
    <li className="flex gap-3">
      <span className="bg-brand/10 text-brand flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">{n}</span>
      <div className="text-sm">
        <div className="font-medium">{title}</div>
        <div className="text-muted mt-0.5">{children}</div>
      </div>
    </li>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardTitle hint="Roda de graça no GitHub Actions — o token nunca fica exposto no site">
          <span className="inline-flex items-center gap-2">
            <Zap size={16} className="text-amber-500" /> Sincronização automática via API do UpSeller
          </span>
        </CardTitle>
        <ol className="space-y-4">
          <Step n={1} title="Gere o token no UpSeller">
            Com a conta principal: <i>Plataforma Aberta → API / MCP → Gerar</i>. Disponível nos planos Pro, Enterprise e Enterprise Plus, sem custo extra. Anote o <b>ID de Cliente</b> e o <b>API Token</b>.
          </Step>
          <Step n={2} title="Use o modo nuvem (Supabase)">
            A sincronização grava os dados no Supabase, que o painel lê. Configure em <i>Configurações</i>.{' '}
            {config.mode === 'supabase' ? <Badge tone="green">ativo</Badge> : <Badge tone="amber">modo local ativo</Badge>}
          </Step>
          <Step n={3} title="Cadastre os secrets no GitHub">
            No repositório: <i>Settings → Secrets and variables → Actions</i>. Crie <code>UPSELLER_API_TOKEN</code>, <code>UPSELLER_CLIENT_ID</code>, <code>SUPABASE_URL</code> e <code>SUPABASE_SERVICE_ROLE_KEY</code>. Na aba <i>Variables</i>, crie <code>UPSELLER_SYNC_ENABLED</code> = <code>true</code>.
          </Step>
          <Step n={4} title="Pronto: roda sozinho a cada 30 min">
            O workflow <code>upseller-sync.yml</code> busca estoque e pedidos e grava no banco. Dá para rodar na hora em <i>Actions → UpSeller sync → Run workflow</i>.
          </Step>
        </ol>
        <div className="mt-5 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <b>Importante:</b> a documentação de endpoints da API do UpSeller é distribuída pelo próprio UpSeller (guia em Feishu). Os endereços dos endpoints ficam configuráveis em <code>scripts/upseller-sync.mjs</code>. Confira-os com o guia antes de ligar a sincronização. Até lá, a importação por planilha cobre tudo.
        </div>
      </Card>

      <Card>
        <CardTitle
          hint="Últimas execuções registradas"
          action={
            supabase && (
              <button className="text-muted rounded-lg p-1.5 hover:bg-hover" onClick={load} title="Atualizar">
                <RefreshCw size={14} />
              </button>
            )
          }
        >
          Histórico
        </CardTitle>
        {!supabase ? (
          <p className="text-muted text-sm">Disponível no modo nuvem.</p>
        ) : runs === null ? (
          <p className="text-muted text-sm">Carregando…</p>
        ) : runs.length === 0 ? (
          <p className="text-muted text-sm">Nenhuma sincronização ainda.</p>
        ) : (
          <ul className="space-y-3">
            {runs.map((r) => (
              <li key={r.id} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span>{dateTime(r.startedAt)}</span>
                  <Badge tone={r.status === 'ok' ? 'green' : r.status === 'running' ? 'blue' : 'red'}>{r.status}</Badge>
                </div>
                {r.message && <p className="text-faint mt-0.5 text-xs break-words">{r.message}</p>}
              </li>
            ))}
          </ul>
        )}
        <div className="text-faint mt-6 space-y-2 border-t border-line pt-4 text-xs">
          <p className="flex items-center gap-1.5">
            <KeyRound size={12} /> Tokens ficam só nos secrets do GitHub.
          </p>
          <p className="flex items-center gap-1.5">
            <Github size={12} /> GitHub Actions: gratuito para repositórios públicos.
          </p>
        </div>
      </Card>
    </div>
  );
}
