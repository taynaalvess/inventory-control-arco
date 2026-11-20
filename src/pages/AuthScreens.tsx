import { useEffect, useState, type ReactNode } from 'react';
import { KeyRound, LogOut, ShieldAlert, ShieldCheck, Smartphone } from 'lucide-react';
import { useStore } from '../lib/store';
import { errMsg } from '../lib/format';
import { Button, Card, Field, Input } from '../components/ui';

function Shell({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle?: ReactNode; children: ReactNode }) {
  const { signOut } = useStore();
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="bg-brand flex h-12 w-12 items-center justify-center rounded-2xl text-white">{icon}</div>
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            {subtitle && <p className="text-muted mt-1 text-sm">{subtitle}</p>}
          </div>
        </div>
        {children}
        <button className="text-muted mt-6 flex w-full items-center justify-center gap-1.5 text-xs hover:underline" onClick={signOut}>
          <LogOut size={12} /> Sair
        </button>
      </Card>
    </div>
  );
}

export function passwordProblems(p: string) {
  const issues: string[] = [];
  if (p.length < 12) issues.push('mínimo 12 caracteres');
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p)) issues.push('letras maiúsculas e minúsculas');
  if (!/\d/.test(p)) issues.push('um número');
  if (!/[^A-Za-z0-9]/.test(p)) issues.push('um símbolo');
  return issues;
}

/** Campo de código de 6 dígitos */
function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="000000"
      className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
    />
  );
}

/* ------------------------- cadastro do 2º fator ------------------------- */
export function MfaEnroll() {
  const { supabase, recheck } = useStore();
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      try {
        // limpa tentativas anteriores não concluídas
        const { data: list } = await supabase.auth.mfa.listFactors();
        for (const f of list?.all ?? []) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Arco Estoque ${new Date().toLocaleDateString('pt-BR')}` });
        if (error) throw error;
        if (!cancelled) setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      } catch (e) {
        if (!cancelled) setError(errMsg(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !factor) return;
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    setBusy(false);
    if (error) return setError('Código inválido. Confira o horário do celular e tente o código atual.');
    await recheck();
  }

  return (
    <Shell icon={<Smartphone size={24} />} title="Ative a verificação em 2 etapas" subtitle="Obrigatória para acessar o sistema. Use Google Authenticator, Microsoft Authenticator, Authy ou 1Password.">
      {!factor ? (
        <p className="text-muted text-center text-sm">{error || 'Gerando QR code…'}</p>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <ol className="text-muted list-decimal space-y-1 pl-4 text-sm">
            <li>Abra o app autenticador e escaneie o QR code.</li>
            <li>Digite o código de 6 dígitos que aparecer.</li>
          </ol>
          <div className="flex justify-center rounded-xl bg-white p-3">
            <img src={factor.qr} alt="QR code para o app autenticador" className="h-44 w-44" />
          </div>
          <details className="text-xs">
            <summary className="text-muted cursor-pointer">Não consegue escanear? Digite a chave</summary>
            <code className="mt-2 block rounded-lg bg-[var(--hover)] p-2 font-mono break-all select-all">{factor.secret}</code>
          </details>
          <CodeInput value={code} onChange={setCode} />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
            {busy ? 'Verificando…' : 'Ativar e entrar'}
          </Button>
        </form>
      )}
    </Shell>
  );
}

/* ------------------------- desafio no login ------------------------- */
export function MfaChallenge() {
  const { supabase, recheck } = useStore();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await supabase.auth.mfa.listFactors();
      const factor = (data?.totp ?? []).find((f) => f.status === 'verified');
      if (!factor) throw new Error('Nenhum autenticador cadastrado.');
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (error) throw new Error('Código inválido ou expirado.');
      await recheck();
    } catch (err) {
      setError(errMsg(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell icon={<ShieldCheck size={24} />} title="Verificação em 2 etapas" subtitle="Digite o código do seu app autenticador">
      <form onSubmit={verify} className="space-y-4">
        <CodeInput value={code} onChange={setCode} />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
          {busy ? 'Verificando…' : 'Confirmar'}
        </Button>
        <p className="text-faint text-center text-xs">Perdeu o celular? Peça a um administrador para redefinir seu 2º fator no painel do Supabase.</p>
      </form>
    </Shell>
  );
}

/* ------------------------- nova senha (link do e-mail) ------------------------- */
export function PasswordRecovery() {
  const { supabase, recheck } = useStore();
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const issues = passwordProblems(pass);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (issues.length) return setError(`A senha precisa de: ${issues.join(', ')}.`);
    if (pass !== confirm) return setError('As senhas não conferem.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pass });
    setBusy(false);
    if (error) return setError(error.message);
    await recheck();
  }

  return (
    <Shell icon={<KeyRound size={24} />} title="Definir nova senha">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nova senha" hint={pass && issues.length ? `Falta: ${issues.join(', ')}` : 'Mín. 12 caracteres, maiúscula, minúscula, número e símbolo'}>
          <Input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
        </Field>
        <Field label="Confirme a senha">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar nova senha'}
        </Button>
      </form>
    </Shell>
  );
}

export function Blocked() {
  const { profile } = useStore();
  return (
    <Shell
      icon={<ShieldAlert size={24} />}
      title="Acesso não liberado"
      subtitle={profile ? 'Sua conta está desativada. Fale com o administrador.' : 'Sua conta ainda não tem perfil. Peça ao administrador para liberar o acesso.'}
    >
      <span />
    </Shell>
  );
}
