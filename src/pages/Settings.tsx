import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cloud, Database, Download, HardDrive, KeyRound, Lock, ShieldCheck, Smartphone, Sparkles, Trash2, Upload, UploadCloud, UserCircle } from 'lucide-react';
import { createClient, type Factor } from '@supabase/supabase-js';
import { useStore } from '../lib/store';
import { type AppConfig } from '../lib/config';
import { readLocalDataset } from '../lib/db/local';
import { generateDemo } from '../lib/demo';
import { download, stamp } from '../lib/files';
import { dateTime, errMsg, num } from '../lib/format';
import { ROLE_HINT, ROLE_LABEL, type Dataset } from '../lib/types';
import { NAV } from '../components/Layout';
import { Badge, Button, Card, CardTitle, Field, Input, PageHeader, cx } from '../components/ui';
import { useToast } from '../components/toast';
import { passwordProblems } from './AuthScreens';

export default function Settings() {
  const { config, setConfig, locked, products, stores, movements, suppliers, purchases, replaceAll, can, supabase } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<AppConfig>(config);
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const admin = can('admin');

  async function testAndSave() {
    if (draft.mode === 'supabase') {
      if (!draft.supabaseUrl || !draft.supabaseKey) return toast('Informe URL e chave anon do Supabase', 'error');
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(draft.supabaseUrl)) return toast('URL inválida. Formato: https://xxxx.supabase.co', 'error');
      setBusy('test');
      try {
        const sb = createClient(draft.supabaseUrl, draft.supabaseKey, { auth: { persistSession: false } });
        const { error } = await sb.from('app_settings').select('id', { head: true, count: 'exact' });
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
    const data: Dataset & { version: number; exportedAt: string } = { version: 2, exportedAt: new Date().toISOString(), products, stores, movements, suppliers, purchases };
    download(`arco-estoque-backup-${stamp()}.json`, JSON.stringify(data), 'application/json');
  };

  async function restore(f: File | undefined) {
    if (!f) return;
    try {
      const d = JSON.parse(await f.text()) as Partial<Dataset>;
      if (!Array.isArray(d.products) || !Array.isArray(d.movements)) throw new Error('Arquivo de backup inválido');
      if (!window.confirm(`Restaurar backup com ${d.products.length} produtos e ${d.movements.length} movimentações? Os dados atuais serão SUBSTITUÍDOS.`)) return;
      await run('restore', () => replaceAll(d as Dataset), 'Backup restaurado');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  const hasData = products.length + movements.length > 0;
  const extraLinks = NAV.filter((n) => !n.mobile && (!n.cap || can(n.cap)));

  return (
    <>
      <PageHeader title="Configurações" subtitle="Conta, segurança, armazenamento e dados" />

      {extraLinks.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:hidden">
          {extraLinks.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className="card flex items-center gap-2 rounded-xl p-3 text-sm font-medium">
              <Icon size={16} className="text-brand shrink-0" /> <span className="truncate">{label}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {supabase && <Account />}

        {!locked && (
          <Card>
            <CardTitle hint="Onde os dados ficam guardados">
              <span className="inline-flex items-center gap-2">
                <Database size={16} /> Armazenamento
              </span>
            </CardTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  { mode: 'local', icon: HardDrive, title: 'Local', text: 'Neste navegador, sem login. Só para testes.' },
                  { mode: 'supabase', icon: Cloud, title: 'Nuvem (Supabase)', text: 'Login, MFA, perfis, auditoria e vários dispositivos. Recomendado.' },
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
                <Field label="Chave anon (public)" hint="É pública por design; a proteção vem do login + MFA + RLS. Nunca use a service_role aqui.">
                  <Input value={draft.supabaseKey} onChange={(e) => setDraft({ ...draft, supabaseKey: e.target.value.trim() })} placeholder="eyJhbGciOi…" />
                </Field>
                <p className="text-faint text-xs">
                  Para produção, configure pelas variáveis do GitHub (<code>VITE_SUPABASE_URL</code>, <code>VITE_SUPABASE_ANON_KEY</code>): o site fica travado no modo nuvem.
                </p>
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Button onClick={testAndSave} disabled={busy === 'test'}>
                {busy === 'test' ? 'Testando…' : 'Salvar e conectar'}
              </Button>
            </div>
          </Card>
        )}

        {locked && (
          <Card>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <Lock size={16} /> Ambiente protegido
              </span>
            </CardTitle>
            <p className="text-muted text-sm">
              Este site está travado no banco em nuvem configurado no deploy. Não há modo local nem como apontar para outro servidor. Todo acesso exige login, perfil ativo e verificação em 2 etapas.
            </p>
            {admin && (
              <Link to="/admin" className="text-brand mt-3 inline-flex items-center gap-1 text-sm font-medium">
                <ShieldCheck size={14} /> Gerenciar usuários e segurança
              </Link>
            )}
          </Card>
        )}

        {admin && (
          <Card>
            <CardTitle hint={`${num(products.length)} produtos · ${num(stores.length)} lojas · ${num(suppliers.length)} fornecedores · ${num(movements.length)} movimentações`}>Backup e dados</CardTitle>
            <div className="space-y-3">
              <Row title="Exportar backup" text="Arquivo .json com tudo. Guarde em local seguro (contém custos e vendas).">
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
                <Row title="Enviar dados locais para a nuvem" text="Copia o que foi cadastrado no modo local deste navegador (substitui a nuvem).">
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
              <Row title="Dados de demonstração" text="Produtos, kits, fornecedores, 4 lojas e 90 dias de vendas fictícias.">
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
              <Row title="Apagar tudo" text="Remove todos os dados. Faça backup antes.">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!!busy || !hasData}
                  onClick={() => {
                    if (window.prompt('Digite APAGAR para confirmar') !== 'APAGAR') return;
                    void run('wipe', () => replaceAll({ products: [], stores: [], movements: [], suppliers: [], purchases: [] }), 'Dados apagados');
                  }}
                >
                  <Trash2 size={14} /> Apagar
                </Button>
              </Row>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function Account() {
  const { supabase, session, profile, role, security } = useStore();
  const toast = useToast();
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [factors, setFactors] = useState<Factor[]>([]);
  const issues = passwordProblems(pass);

  const loadFactors = useCallback(async () => {
    const { data } = await supabase!.auth.mfa.listFactors();
    setFactors((data?.all ?? []).filter((f) => f.status === 'verified'));
  }, [supabase]);

  useEffect(() => void loadFactors(), [loadFactors]);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (issues.length) return toast(`A senha precisa de: ${issues.join(', ')}`, 'error');
    if (pass !== confirm) return toast('As senhas não conferem', 'error');
    setBusy(true);
    const { error } = await supabase!.auth.updateUser({ password: pass });
    setBusy(false);
    if (error) return toast(/reauth/i.test(error.message) ? 'Por segurança, saia e entre novamente antes de trocar a senha.' : error.message, 'error');
    setPass('');
    setConfirm('');
    toast('Senha alterada');
  }

  async function removeFactor(f: Factor) {
    if (security.requireMfa && factors.length <= 1) return toast('A verificação em 2 etapas é obrigatória. Para trocar de celular, peça ao admin para redefinir no Supabase.', 'error');
    if (!window.confirm('Remover este autenticador?')) return;
    const { error } = await supabase!.auth.mfa.unenroll({ factorId: f.id });
    if (error) return toast(error.message, 'error');
    toast('Autenticador removido');
    void loadFactors();
  }

  return (
    <Card>
      <CardTitle>
        <span className="inline-flex items-center gap-2">
          <UserCircle size={16} /> Minha conta
        </span>
      </CardTitle>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{profile?.email ?? session?.user.email}</span>
        <Badge tone="violet">{ROLE_LABEL[role]}</Badge>
      </div>
      <p className="text-faint -mt-2 mb-4 text-xs">{ROLE_HINT[role]}</p>

      <div className="mb-4 rounded-xl border border-line p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Smartphone size={14} /> Verificação em 2 etapas
          {factors.length ? <Badge tone="green">ativa</Badge> : <Badge tone="amber">inativa</Badge>}
        </div>
        {factors.map((f) => (
          <div key={f.id} className="text-muted flex items-center justify-between gap-2 text-xs">
            <span>
              {f.friendly_name || 'Autenticador'} · desde {dateTime(f.created_at)}
            </span>
            <button className="text-rose-600 hover:underline" onClick={() => removeFactor(f)}>
              remover
            </button>
          </div>
        ))}
        {!factors.length && <p className="text-faint text-xs">Saia e entre novamente para cadastrar (se a política exigir) ou peça ao admin para tornar obrigatória.</p>}
      </div>

      <form onSubmit={changePassword} className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <KeyRound size={14} /> Trocar senha
        </p>
        <Input type="password" autoComplete="new-password" placeholder="Nova senha" value={pass} onChange={(e) => setPass(e.target.value)} />
        <Input type="password" autoComplete="new-password" placeholder="Confirme a nova senha" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {pass && issues.length > 0 && <p className="text-xs text-amber-600">Falta: {issues.join(', ')}</p>}
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={busy || !pass}>
            Alterar senha
          </Button>
        </div>
      </form>
    </Card>
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
