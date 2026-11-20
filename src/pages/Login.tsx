import { useEffect, useState } from 'react';
import { Lock, ScanBarcode } from 'lucide-react';
import { useStore } from '../lib/store';
import { Button, Card, Field, Input } from '../components/ui';

const MAX_TRIES = 5;
const LOCK_SECONDS = 60;

export default function Login() {
  const { supabase, config, setConfig, locked } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [forgot, setForgot] = useState(false);

  useEffect(() => {
    if (lockUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockUntil]);

  const wait = Math.max(0, Math.ceil((lockUntil - now) / 1000));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || wait) return;
    setBusy(true);
    setError('');
    setInfo('');
    if (forgot) {
      const redirectTo = `${location.origin}${location.pathname}`;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      setBusy(false);
      // mesma mensagem em qualquer caso: não revela se o e-mail existe
      if (error && !/rate/i.test(error.message)) console.warn(error.message);
      setInfo('Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha. Abra o link neste mesmo navegador.');
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      const n = fails + 1;
      setFails(n);
      setPassword('');
      if (n >= MAX_TRIES) {
        setLockUntil(Date.now() + LOCK_SECONDS * 1000 * Math.min(8, 2 ** (n - MAX_TRIES)));
        setNow(Date.now());
      }
      setError(/rate|too many/i.test(error.message) ? 'Muitas tentativas. Aguarde alguns minutos.' : 'E-mail ou senha inválidos.');
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="bg-brand flex h-12 w-12 items-center justify-center rounded-2xl text-white">
            <ScanBarcode size={24} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Arco Estoque</h1>
            <p className="text-muted text-sm">{forgot ? 'Recuperar acesso' : 'Acesso restrito'}</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="E-mail">
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          {!forgot && (
            <Field label="Senha">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
          )}
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {info && <p className="text-sm text-emerald-600">{info}</p>}
          <Button type="submit" className="w-full" disabled={busy || wait > 0}>
            {wait > 0 ? `Aguarde ${wait}s` : busy ? 'Aguarde…' : forgot ? 'Enviar link' : 'Entrar'}
          </Button>
        </form>
        <button
          className="text-brand mt-4 w-full text-center text-xs font-medium hover:underline"
          onClick={() => {
            setForgot(!forgot);
            setError('');
            setInfo('');
          }}
        >
          {forgot ? 'Voltar ao login' : 'Esqueci minha senha'}
        </button>
        <p className="text-faint mt-6 flex items-center justify-center gap-1.5 text-xs">
          <Lock size={12} /> Conexão criptografada · verificação em 2 etapas
        </p>
        {!locked && (
          <button className="text-muted mt-3 w-full text-center text-xs hover:underline" onClick={() => setConfig({ ...config, mode: 'local' })}>
            Usar modo local (sem login, só para testes)
          </button>
        )}
      </Card>
    </div>
  );
}
