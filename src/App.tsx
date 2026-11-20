import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { StoreProvider, useStore } from './lib/store';
import { ToastProvider } from './components/toast';
import { Layout } from './components/Layout';
import { Button, Card } from './components/ui';
import Login from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Scan = lazy(() => import('./pages/Scan'));
const Products = lazy(() => import('./pages/Products'));
const Movements = lazy(() => import('./pages/Movements'));
const Stores = lazy(() => import('./pages/Stores'));
const Integrations = lazy(() => import('./pages/Integrations'));
const Settings = lazy(() => import('./pages/Settings'));

function Loading() {
  return (
    <div className="text-muted flex min-h-[50vh] items-center justify-center gap-2 text-sm">
      <Loader2 className="animate-spin" size={18} /> Carregando…
    </div>
  );
}

function Gate() {
  const { status, error, reload, config, setConfig } = useStore();
  if (status === 'loading') return <Loading />;
  if (status === 'auth') return <Login />;
  if (status === 'error')
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg items-center p-4">
        <Card className="w-full">
          <div className="mb-3 flex items-center gap-2 font-semibold text-rose-600">
            <AlertTriangle size={18} /> Não foi possível carregar os dados
          </div>
          <p className="text-muted mb-4 text-sm break-words">{error}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={reload}>Tentar novamente</Button>
            {config.mode === 'supabase' && (
              <Button variant="secondary" onClick={() => setConfig({ ...config, mode: 'local' })}>
                Usar modo local
              </Button>
            )}
          </div>
        </Card>
      </div>
    );

  return (
    <Layout>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/bipagem" element={<Scan />} />
          <Route path="/produtos" element={<Products />} />
          <Route path="/movimentacoes" element={<Movements />} />
          <Route path="/lojas" element={<Stores />} />
          <Route path="/integracoes" element={<Integrations />} />
          <Route path="/configuracoes" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

export default function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <StoreProvider>
          <Gate />
        </StoreProvider>
      </ToastProvider>
    </HashRouter>
  );
}
