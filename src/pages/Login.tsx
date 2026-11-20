import { useState } from 'react';
import { ScanBarcode } from 'lucide-react';
import { useStore } from '../lib/store';
import { Button, Card, Field, Input } from '../components/ui';

export default function Login() {
  const { supabase, config, setConfig } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message === 'Invalid login credentials' ? 'E-mail ou senha inválidos.' : error.message);
    setBusy(false);
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
            <p className="text-muted text-sm">Entre com seu usuário do Supabase</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="E-mail">
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Senha">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
        <button className="text-muted mt-6 w-full text-center text-xs hover:underline" onClick={() => setConfig({ ...config, mode: 'local' })}>
          Usar modo local (sem login, dados só neste navegador)
        </button>
      </Card>
    </div>
  );
}
