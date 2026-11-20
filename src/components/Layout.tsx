import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  ArrowLeftRight,
  Cloud,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Moon,
  Package,
  Plug,
  RefreshCw,
  ScanBarcode,
  Settings,
  Store,
  Sun,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { cx } from './ui';

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, mobile: true },
  { to: '/bipagem', label: 'Bipagem', icon: ScanBarcode, mobile: true },
  { to: '/produtos', label: 'Produtos', icon: Package, mobile: true },
  { to: '/movimentacoes', label: 'Movimentações', icon: ArrowLeftRight, mobile: false },
  { to: '/lojas', label: 'Lojas', icon: Store, mobile: true },
  { to: '/integracoes', label: 'UpSeller', icon: Plug, mobile: false },
  { to: '/configuracoes', label: 'Ajustes', icon: Settings, mobile: true },
];

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem('arco.theme');
      if (saved) return saved === 'dark';
    } catch {
      /* ignora */
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('arco.theme', dark ? 'dark' : 'light');
    } catch {
      /* ignora */
    }
  }, [dark]);
  return [dark, setDark] as const;
}

export function Layout({ children }: { children: ReactNode }) {
  const { config, userEmail, signOut, reload } = useStore();
  const [dark, setDark] = useTheme();
  const [spin, setSpin] = useState(false);
  const cloud = config.mode === 'supabase';

  const refresh = async () => {
    setSpin(true);
    await reload();
    setSpin(false);
  };

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Sidebar desktop */}
      <aside className="card fixed inset-y-0 left-0 hidden w-64 flex-col rounded-none border-y-0 border-l-0 px-4 py-5 lg:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="bg-brand flex h-9 w-9 items-center justify-center rounded-xl text-white">
            <ScanBarcode size={20} />
          </div>
          <div>
            <div className="text-sm leading-tight font-semibold">Arco Estoque</div>
            <div className="text-faint text-xs">Controle & métricas</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                  isActive ? 'bg-brand/10 text-brand dark:text-indigo-300' : 'text-muted hover:bg-hover',
                )
              }
            >
              <Icon size={18} />
              {label === 'UpSeller' ? 'Integração UpSeller' : label === 'Ajustes' ? 'Configurações' : label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line pt-4">
          <div className="text-muted flex items-center gap-2 px-2 text-xs">
            {cloud ? <Cloud size={14} className="text-emerald-500" /> : <HardDrive size={14} className="text-amber-500" />}
            <span className="truncate">{cloud ? userEmail ?? 'Nuvem (Supabase)' : 'Modo local (este navegador)'}</span>
          </div>
          <div className="mt-3 flex gap-1">
            <button onClick={() => setDark(!dark)} className="text-muted rounded-lg p-2 hover:bg-hover" title="Alternar tema">
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button onClick={refresh} className="text-muted rounded-lg p-2 hover:bg-hover" title="Recarregar dados">
              <RefreshCw size={16} className={spin ? 'animate-spin' : ''} />
            </button>
            {cloud && userEmail && (
              <button onClick={signOut} className="text-muted rounded-lg p-2 hover:bg-hover" title="Sair">
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Topo mobile */}
      <header className="card sticky top-0 z-30 flex items-center justify-between rounded-none border-x-0 border-t-0 px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <div className="bg-brand flex h-8 w-8 items-center justify-center rounded-lg text-white">
            <ScanBarcode size={18} />
          </div>
          <span className="text-sm font-semibold">Arco Estoque</span>
        </div>
        <div className="flex items-center gap-1">
          {cloud ? <Cloud size={16} className="text-emerald-500" /> : <HardDrive size={16} className="text-amber-500" />}
          <button onClick={refresh} className="text-muted rounded-lg p-2 hover:bg-hover" aria-label="Recarregar">
            <RefreshCw size={16} className={spin ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setDark(!dark)} className="text-muted rounded-lg p-2 hover:bg-hover" aria-label="Tema">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pb-10">{children}</main>

      {/* Navegação inferior mobile */}
      <nav className="card fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV.filter((n) => n.mobile).map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cx('flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium', isActive ? 'text-brand dark:text-indigo-300' : 'text-faint')
            }
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
