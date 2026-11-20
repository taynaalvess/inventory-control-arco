import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, Cloud, Database, Download, HardDrive, Plug, Sparkles, Trash2, Upload, UploadCloud } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { useStore } from '../lib/store';
import { hasEnvSupabase, type AppConfig } from '../lib/config';
import { readLocalDataset } from '../lib/db/local';
import { generateDemo } from '../lib/demo';
import { download, stamp } from '../lib/files';
import { errMsg, num } from '../lib/format';
import type { Dataset } from '../lib/types';
import { Badge, Button, Card, CardTitle, Field, Input, PageHeader, cx } from '../components/ui';
import { useToast } from '../components/toast';

export default function Settings() {
  const { config, setConfig, products, stores, movements, replaceAll, userEmail, signOut } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<AppConfig>(config);
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function testAndSave() {
    if (draft.mode === 'supabase') {
      if (!draft.supabaseUrl || !draft.supabaseKey) return toast('Informe URL e chave anon do Supabase', 'error');
      setBusy('test');
      try {
        const sb = createClient(draft.supabaseUrl, draft.supabaseKey, { auth: { persistSession: false } });
        const { error } = await sb.from('products').select('id', { head: true, count: 'exact' });
        // RLS sem login retorna vazio (não erro); erro aqui = URL/chave/tabela inválida
        if (error) throw new Error(error.message);
      } catch (e) {
        setBusy('');
        return toast(`Falha ao conectar: ${errMsg(e)}. Rodou o supabase/schema.sql?`, 'error');
      }
      setBusy('');
    }
    setConfig(draft);
    toast('Configuração salva');
  }

  async function run(label: string, fn: () => Promise<void>, ok: string) {
    setBusy(label);
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy('');
    }
  }

  const backup = () => {
    const data: Dataset & { version: number; exportedAt: string } = { version: 1, exportedAt: new Date().toISOString(), products, stores, movements };
    download(`arco-estoque-backup-${stamp()}.json`, JSON.stringify(data), 'application/json');
  };

  async function restore(f: File | undefined) {
    if (!f) return;
    try {
      const d = JSON.parse(await f.text()) as Dataset;
      if (!Array.isArray(d.products) || !Array.isArray(d.movements) || !Array.isArray(d.stores)) throw new Error('Arquivo de backup inválido');
      if (!window.confirm(`Restaurar backup com ${d.products.length} produtos e ${d.movements.length} movimentações? Os dados atuais serão SUBSTITUÍDOS.`)) return;
      await run('restore', () => replaceAll(d), 'Backup restaurado');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  const hasData = products.length + movements.length > 0;

  return (
    <>
      <PageHeader title="Configurações" subtitle="Armazenamento, backup e dados" />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:hidden">
        <Link to="/movimentacoes" className="card flex items-center gap-2 rounded-xl p-3 text-sm font-medium">
          <ArrowLeftRight size={16} className="text-brand" /> Movimentações
        </Link>
        <Link to="/integracoes" className="card flex items-center gap-2 rounded-xl p-3 text-sm font-medium">
          <Plug size={16} className="text-brand" /> Integração UpSeller
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint="Onde os dados ficam guardados">
            <span className="inline-flex items-center gap-2">
              <Database size={16} /> Armazenamento
            </span>
          </CardTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                { mode: 'local', icon: HardDrive, title: 'Local', text: 'Neste navegador. Zero configuração, ideal para testar. Não sincroniza entre dispositivos.' },
                { mode: 'supabase', icon: Cloud, title: 'Nuvem (Supabase)', text: 'Grátis. Celular e computador veem os mesmos dados, com login. Recomendado.' },
              ] as const
            ).map((o) => (
              <button
                key={o.mode}
                onClick={() => setDraft({ ...draft, mode: o.mode })}
                className={cx('rounded-xl border p-3 text-left transition', draft.mode === o.mode ? 'border-brand ring-brand/20 ring-4' : 'border-line hover:bg-hover')}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <o.icon size={16} /> {o.title} {config.mode === o.mode && <Badge tone="green">atual</Badge>}
                </div>
                <p className="text-muted mt-1 text-xs">{o.text}</p>
              </button>
            ))}
          </div>

          {draft.mode === 'supabase' && (
            <div className="mt-4 space-y-3">
              <Field label="Project URL" hint="Supabase → Project Settings → API">
                <Input value={draft.supabaseUrl} onChange={(e) => setDraft({ ...draft, supabaseUrl: e.target.value.trim() })} placeholder="https://xxxx.supabase.co" />
              </Field>
              <Field label="Chave anon (public)" hint="É pública por design; a segurança vem do login + RLS. Nunca use a service_role aqui.">
                <Input value={draft.supabaseKey} onChange={(e) => setDraft({ ...draft, supabaseKey: e.target.value.trim() })} placeholder="eyJhbGciOi…" />
              </Field>
              {hasEnvSupabase && <p className="text-faint text-xs">Este site já vem configurado pelo build (variáveis do GitHub).</p>}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            {config.mode === 'supabase' && userEmail ? (
              <span className="text-muted text-xs">
                Conectada como <b>{userEmail}</b> ·{' '}
                <button className="text-brand" onClick={signOut}>
                  sair
                </button>
              </span>
            ) : (
              <span />
            )}
            <Button onClick={testAndSave} disabled={busy === 'test'}>
              {busy === 'test' ? 'Testando…' : 'Salvar e conectar'}
            </Button>
          </div>
        </Card>

        <Card>
          <CardTitle hint={`${num(products.length)} produtos · ${num(stores.length)} lojas · ${num(movements.length)} movimentações`}>Backup e dados</CardTitle>
          <div className="space-y-3">
            <Row title="Exportar backup" text="Arquivo .json com tudo. Guarde no Drive ou commit privado.">
              <Button variant="secondary" size="sm" onClick={backup}>
                <Download size={14} /> Baixar
              </Button>
            </Row>
            <Row title="Restaurar backup" text="Substitui os dados atuais pelo conteúdo do arquivo.">
              <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={!!busy}>
                <Upload size={14} /> {busy === 'restore' ? 'Restaurando…' : 'Escolher'}
              </Button>
              <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => (void restore(e.target.files?.[0]), (e.target.value = ''))} />
            </Row>
            {config.mode === 'supabase' && (
              <Row title="Enviar dados locais para a nuvem" text="Copia o que você cadastrou no modo local deste navegador para o Supabase (substitui a nuvem).">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!!busy}
                  onClick={async () => {
                    const local = await readLocalDataset();
                    if (!local.products.length) return toast('Não há dados locais neste navegador', 'info');
                    if (!window.confirm(`Enviar ${local.products.length} produtos e ${local.movements.length} movimentações para a nuvem? Os dados atuais da nuvem serão substituídos.`)) return;
                    await run('migrate', () => replaceAll(local), 'Dados enviados para a nuvem');
                  }}
                >
                  <UploadCloud size={14} /> {busy === 'migrate' ? 'Enviando…' : 'Enviar'}
                </Button>
              </Row>
            )}
            <Row title="Dados de demonstração" text="20 produtos, 4 lojas e 90 dias de vendas fictícias para explorar o painel.">
              <Button
                variant="secondary"
                size="sm"
                disabled={!!busy}
                onClick={() => {
                  if (hasData && !window.confirm('Isso SUBSTITUI os dados atuais por dados fictícios. Continuar?')) return;
                  void run('demo', () => replaceAll(generateDemo()), 'Dados de demonstração carregados');
                }}
              >
                <Sparkles size={14} /> {busy === 'demo' ? 'Gerando…' : 'Carregar'}
              </Button>
            </Row>
            <Row title="Apagar tudo" text="Remove produtos, lojas e movimentações. Faça backup antes.">
              <Button
                variant="danger"
                size="sm"
                disabled={!!busy || !hasData}
                onClick={() => {
                  if (window.prompt('Digite APAGAR para confirmar') !== 'APAGAR') return;
                  void run('wipe', () => replaceAll({ products: [], stores: [], movements: [] }), 'Dados apagados');
                }}
              >
                <Trash2 size={14} /> Apagar
              </Button>
            </Row>
          </div>
        </Card>
      </div>
    </>
  );
}

function Row({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-muted text-xs">{text}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
