import { lazy, Suspense, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { StoreProvider, useStore, type Cap } from './lib/store';
import { ToastProvider } from './components/toast';
import { Layout } from './components/Layout';
import { Button, Card } from './components/ui';
import Login from './pages/Login';
import { Blocked, MfaChallenge, MfaEnroll, PasswordRecovery } from './pages/AuthScreens';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Scan = lazy(() => import('./pages/Scan'));
const Products = lazy(() => import('./pages/Products'));
const ProductDetail = lazy(() => import('./pages/ProductDetail'));
const Purchases = lazy(() => import('./pages/Purchases'));
const Movements = lazy(() => import('./pages/Movements'));
const Stores = lazy(() => import('./pages/Stores'));
const Reports = lazy(() => import('./pages/Reports'));
const Integrations = lazy(() => import('./pages/Integrations'));
const Admin = lazy(() => import('./pages/Admin'));
const Settings = lazy(() => import('./pages/Settings'));

function Loading() {
  return (
    <div className="text-muted flex min-h-[50vh] items-center justify-center gap-2 text-sm">
      <Loader2 className="animate-spin" size={18} /> Carregando…
    </div>
  );
}

/** Bloqueia a rota se o perfil não tiver a capacidade (o banco também bloqueia). */
function Guard({ cap, children }: { cap: Cap; children: ReactNode }) {
  const { can } = useStore();
  if (can(cap)) return <>{children}</>;
  return <Navigate to={can('finance') ? '/' : can('scan') ? '/bipagem' : '/produtos'} replace />;
}

function Home() {
  const { can } = useStore();
  if (can('finance')) return <Dashboard />;
  return <Navigate to={can('scan') ? '/bipagem' : '/produtos'} replace />;
}

function Gate() {
  const { status, error, recheck, config, setConfig, locked, signOut } = useStore();
  if (status === 'loading') return <Loading />;
  if (status === 'auth') return <Login />;
  if (status === 'mfa-enroll') return <MfaEnroll />;
  if (status === 'mfa-challenge') return <MfaChallenge />;
  if (status === 'recovery') return <PasswordRecovery />;
  if (status === 'blocked') return <Blocked />;
  if (status === 'error')
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg items-center p-4">
        <Card className="w-full">
          <div className="mb-3 flex items-center gap-2 font-semibold text-rose-600">
            <AlertTriangle size={18} /> Não foi possível carregar os dados
          </div>
          <p className="text-muted mb-4 text-sm break-words">{error}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={recheck}>Tentar novamente</Button>
            {config.mode === 'supabase' && (
              <Button variant="secondary" onClick={signOut}>
                Sair
              </Button>
            )}
            {config.mode === 'supabase' && !locked && (
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
          <Route path="/" element={<Home />} />
          <Route path="/bipagem" element={<Guard cap="scan"><Scan /></Guard>} />
          <Route path="/produtos" element={<Products />} />
          <Route path="/produtos/:id" element={<ProductDetail />} />
          <Route path="/compras" element={<Guard cap="scan"><Purchases /></Guard>} />
          <Route path="/movimentacoes" element={<Movements />} />
          <Route path="/lojas" element={<Guard cap="finance"><Stores /></Guard>} />
          <Route path="/relatorios" element={<Guard cap="finance"><Reports /></Guard>} />
          <Route path="/integracoes" element={<Guard cap="manage"><Integrations /></Guard>} />
          <Route path="/admin" element={<Guard cap="admin"><Admin /></Guard>} />
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
