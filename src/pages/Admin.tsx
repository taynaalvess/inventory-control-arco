import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, History, RefreshCw, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useStore } from '../lib/store';
import { fetchAudit, fetchProfiles, saveSecurity, updateProfile, type AuditEntry } from '../lib/db/supabase';
import { dateTime, errMsg } from '../lib/format';
import { ROLE_HINT, ROLE_LABEL, type Profile, type Role } from '../lib/types';
import { Badge, Button, Card, CardTitle, Empty, Field, Input, PageHeader, Segmented, Select } from '../components/ui';
import { useToast } from '../components/toast';

export default function Admin() {
  const { supabase } = useStore();
  const [tab, setTab] = useState<'usuarios' | 'auditoria' | 'seguranca'>('usuarios');
  return (
    <>
      <PageHeader
        title="Administração"
        subtitle="Usuários, permissões, trilha de auditoria e políticas de segurança"
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'usuarios', label: 'Usuários' },
              { value: 'auditoria', label: 'Auditoria' },
              { value: 'seguranca', label: 'Segurança' },
            ]}
          />
        }
      />
      {!supabase ? (
        <Card>
          <Empty icon={<ShieldCheck size={36} />} title="Disponível no modo nuvem" text="Usuários, perfis, MFA e auditoria dependem do Supabase. Configure em Configurações." />
        </Card>
      ) : tab === 'usuarios' ? (
        <UsersTab />
      ) : tab === 'auditoria' ? (
        <AuditTab />
      ) : (
        <SecurityTab />
      )}
    </>
  );
}

function UsersTab() {
  const { supabase, session } = useStore();
  const toast = useToast();
  const [list, setList] = useState<Profile[] | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await fetchProfiles(supabase!));
    } catch (e) {
      toast(errMsg(e), 'error');
      setList([]);
    }
  }, [supabase, toast]);

  useEffect(() => void load(), [load]);

  async function patch(p: Profile, change: Partial<Pick<Profile, 'role' | 'active' | 'name'>>) {
    if (p.id === session?.user.id && (change.active === false || (change.role && change.role !== 'admin')) && !window.confirm('Você vai reduzir o seu próprio acesso. Continuar?')) return;
    try {
      await updateProfile(supabase!, p.id, change);
      toast('Usuário atualizado');
      await load();
    } catch (e) {
      toast(errMsg(e).replace(/.*: /, ''), 'error');
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-0 sm:p-0 lg:col-span-2">
        <div className="p-4 sm:p-5">
          <CardTitle hint="Perfil e status de cada pessoa com acesso" action={<button className="text-muted rounded-lg p-1.5 hover:bg-hover" onClick={load} title="Atualizar"><RefreshCw size={14} /></button>}>
            <span className="inline-flex items-center gap-2">
              <Users size={16} /> Usuários
            </span>
          </CardTitle>
        </div>
        {list === null ? (
          <p className="text-muted p-5 text-sm">Carregando…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>E-mail</th>
                  <th>Perfil</th>
                  <th>Status</th>
                  <th>Desde</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="font-medium">{p.email}</div>
                      {p.id === session?.user.id && <span className="text-faint text-xs">você</span>}
                    </td>
                    <td>
                      <Select value={p.role} onChange={(e) => patch(p, { role: e.target.value as Role })} className="h-8 w-40 text-xs">
                        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td>
                      <button onClick={() => patch(p, { active: !p.active })} title={p.active ? 'Clique para desativar' : 'Clique para reativar'}>
                        <Badge tone={p.active ? 'green' : 'red'}>{p.active ? 'Ativo' : 'Desativado'}</Badge>
                      </button>
                    </td>
                    <td className="text-muted text-xs whitespace-nowrap">{dateTime(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="space-y-4">
        <Card>
          <CardTitle>
            <span className="inline-flex items-center gap-2">
              <UserPlus size={16} /> Adicionar pessoa
            </span>
          </CardTitle>
          <ol className="text-muted list-decimal space-y-2 pl-4 text-sm">
            <li>
              No Supabase: <i>Authentication → Users → Add user → Send invitation</i> (ou <i>Create new user</i>).
            </li>
            <li>A pessoa aparece aqui como <b>Somente leitura</b>.</li>
            <li>Escolha o perfil certo. No primeiro acesso ela cadastra a verificação em 2 etapas.</li>
          </ol>
          <p className="text-faint mt-3 text-xs">O cadastro público fica desligado: ninguém cria conta sozinho.</p>
        </Card>
        <Card>
          <CardTitle>Perfis de acesso</CardTitle>
          <ul className="space-y-3 text-sm">
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <li key={r}>
                <div className="font-medium">{ROLE_LABEL[r]}</div>
                <div className="text-muted text-xs">{ROLE_HINT[r]}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

const TABLE_LABEL: Record<string, string> = {
  products: 'Produto',
  stores: 'Loja',
  suppliers: 'Fornecedor',
  purchase_orders: 'Compra',
  profiles: 'Usuário',
  app_settings: 'Segurança',
  movements: 'Movimentação',
};
const ACTION_TONE: Record<string, 'green' | 'blue' | 'red'> = { insert: 'green', update: 'blue', delete: 'red' };
const ACTION_LABEL: Record<string, string> = { insert: 'criou', update: 'alterou', delete: 'excluiu' };

function changedFields(e: AuditEntry) {
  if (e.action !== 'update' || !e.oldData || !e.newData) return [];
  return Object.keys(e.newData).filter((k) => k !== 'updated_at' && JSON.stringify(e.oldData![k]) !== JSON.stringify(e.newData![k]));
}

function AuditTab() {
  const { supabase } = useStore();
  const toast = useToast();
  const [table, setTable] = useState('');
  const [list, setList] = useState<AuditEntry[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    setList(null);
    try {
      setList(await fetchAudit(supabase!, { table: table || undefined }));
    } catch (e) {
      toast(errMsg(e), 'error');
      setList([]);
    }
  }, [supabase, table, toast]);

  useEffect(() => void load(), [load]);

  return (
    <Card className="p-0 sm:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <History size={16} /> Trilha de auditoria
          </h3>
          <p className="text-muted text-xs">Registro imutável: quem criou, alterou ou excluiu o quê. Nem o admin consegue apagar.</p>
        </div>
        <div className="flex gap-2">
          <Select value={table} onChange={(e) => setTable(e.target.value)} className="h-9 w-auto">
            <option value="">Tudo</option>
            {Object.entries(TABLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Button variant="secondary" size="sm" onClick={load}>
            <RefreshCw size={14} />
          </Button>
        </div>
      </div>
      {list === null ? (
        <p className="text-muted p-5 text-sm">Carregando…</p>
      ) : list.length === 0 ? (
        <Empty title="Nenhum registro" />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((e) => {
            const rec = (e.newData ?? e.oldData ?? {}) as Record<string, unknown>;
            const label = String(rec.name ?? rec.number ?? rec.email ?? rec.sku ?? e.recordId ?? '');
            const fields = changedFields(e);
            return (
              <li key={e.id} className="px-4 py-3 text-sm sm:px-5">
                <button className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-left" onClick={() => setOpen(open === e.id ? null : e.id)}>
                  <span className="text-muted w-32 shrink-0 text-xs">{dateTime(e.at)}</span>
                  <span className="font-medium">{e.actorEmail}</span>
                  <Badge tone={ACTION_TONE[e.action] ?? 'neutral'}>{ACTION_LABEL[e.action] ?? e.action}</Badge>
                  <span className="text-muted">{TABLE_LABEL[e.table] ?? e.table}</span>
                  <span className="truncate">{label}</span>
                  {fields.length > 0 && <span className="text-faint text-xs">({fields.join(', ')})</span>}
                </button>
                {open === e.id && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {e.oldData && (
                      <pre className="max-h-64 overflow-auto rounded-xl bg-rose-500/5 p-3 text-xs">{JSON.stringify(fields.length ? Object.fromEntries(fields.map((f) => [f, e.oldData![f]])) : e.oldData, null, 2)}</pre>
                    )}
                    {e.newData && (
                      <pre className="max-h-64 overflow-auto rounded-xl bg-emerald-500/5 p-3 text-xs">{JSON.stringify(fields.length ? Object.fromEntries(fields.map((f) => [f, e.newData![f]])) : e.newData, null, 2)}</pre>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function SecurityTab() {
  const { supabase, security, setSecurityState } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState(security);

  async function save() {
    try {
      await saveSecurity(supabase!, draft);
      setSecurityState(draft);
      toast('Política de segurança salva');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  const checklist = [
    ['Authentication → Sign In / Providers', 'Desligar "Allow new users to sign up"'],
    ['Authentication → Sign In / Providers → Email', 'Ligar "Confirm email" e "Secure password change"'],
    ['Authentication → Policies (Password)', 'Tamanho mínimo 12 e exigir maiúsculas, minúsculas, números e símbolos'],
    ['Authentication → URL Configuration', 'Site URL = endereço do GitHub Pages (para os links de recuperação)'],
    ['Authentication → Multi-Factor', 'TOTP (app autenticador) habilitado'],
    ['Authentication → Rate Limits', 'Manter os limites padrão de tentativas de login'],
    ['Project Settings → API', 'Nunca expor a chave service_role (só nos secrets do GitHub)'],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle hint="Aplicado pelo banco de dados a todos os usuários">Política de acesso</CardTitle>
        <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
          <input type="checkbox" className="accent-brand mt-1 h-4 w-4" checked={draft.requireMfa} onChange={(e) => setDraft({ ...draft, requireMfa: e.target.checked })} />
          <span>
            <b>Exigir verificação em 2 etapas (MFA)</b>
            <span className="text-muted block text-xs">Sem o código do app autenticador, o banco nega acesso a todos os dados, mesmo com a senha certa. Recomendado: ligado.</span>
          </span>
        </label>
        <Field label="Encerrar sessão após inatividade (minutos)" className="mt-4" hint="Entre 5 e 480">
          <Input type="number" min={5} max={480} value={draft.idleMinutes} onChange={(e) => setDraft({ ...draft, idleMinutes: Math.min(480, Math.max(5, Number(e.target.value) || 30)) })} />
        </Field>
        <div className="mt-4 flex justify-end">
          <Button onClick={save}>Salvar política</Button>
        </div>
      </Card>

      <Card>
        <CardTitle hint="Ajustes feitos no painel do Supabase (uma vez)">Checklist de blindagem</CardTitle>
        <ul className="space-y-3 text-sm">
          {checklist.map(([where, what]) => (
            <li key={where} className="flex gap-2">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" />
              <span>
                <b>{what}</b>
                <span className="text-faint block text-xs">{where}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="text-muted mt-4 rounded-xl bg-[var(--hover)] p-3 text-xs">
          Já ativo no sistema: dados acessíveis só com login + perfil ativo (RLS), MFA exigido pelo banco, permissões por perfil, movimentações imutáveis, auditoria imutável, logout por inatividade, CSP contra injeção de scripts e conexão HTTPS.
        </div>
      </Card>
    </div>
  );
}
