import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  ArrowLeftRight,
  BarChart3,
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
  ShieldCheck,
  Store,
  Sun,
  Truck,
} from 'lucide-react';
import { useStore, type Cap } from '../lib/store';
import { ROLE_LABEL } from '../lib/types';
import { useToast } from './toast';
import { Badge, cx } from './ui';

export const NAV: { to: string; label: string; short: string; icon: typeof Package; cap: Cap | null; mobile: boolean }[] = [
  { to: '/', label: 'Dashboard', short: 'Painel', icon: LayoutDashboard, cap: 'finance', mobile: true },
  { to: '/bipagem', label: 'Bipagem', short: 'Bipar', icon: ScanBarcode, cap: 'scan', mobile: true },
  { to: '/produtos', label: 'Produtos', short: 'Produtos', icon: Package, cap: null, mobile: true },
  { to: '/compras', label: 'Compras', short: 'Compras', icon: Truck, cap: 'scan', mobile: true },
  { to: '/movimentacoes', label: 'Movimentações', short: 'Movim.', icon: ArrowLeftRight, cap: null, mobile: false },
  { to: '/lojas', label: 'Lojas', short: 'Lojas', icon: Store, cap: 'finance', mobile: true },
  { to: '/relatorios', label: 'Relatórios', short: 'Relatórios', icon: BarChart3, cap: 'finance', mobile: false },
  { to: '/integracoes', label: 'Integração UpSeller', short: 'UpSeller', icon: Plug, cap: 'manage', mobile: false },
  { to: '/admin', label: 'Administração', short: 'Admin', icon: ShieldCheck, cap: 'admin', mobile: false },
  { to: '/configuracoes', label: 'Configurações', short: 'Mais', icon: Settings, cap: null, mobile: true },
];

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
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

/** Encerra a sessão após X minutos sem interação (configurável pelo admin). */
function useIdleLogout(enabled: boolean, minutes: number, onIdle: () => void) {
  const last = useRef(Date.now());
  const cb = useRef(onIdle);
  cb.current = onIdle;
  useEffect(() => {
    if (!enabled) return;
    last.current = Date.now();
    const bump = () => (last.current = Date.now());
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'visibilitychange'] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - last.current > minutes * 60_000) cb.current();
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, [enabled, minutes]);
}

export function Layout({ children }: { children: ReactNode }) {
  const { config, session, profile, role, can, signOut, reload, security, supabase } = useStore();
  const toast = useToast();
  const [dark, setDark] = useTheme();
  const [spin, setSpin] = useState(false);
  const cloud = config.mode === 'supabase';

  useIdleLogout(Boolean(supabase && session), security.idleMinutes, () => {
    void signOut();
    toast(`Sessão encerrada após ${security.idleMinutes} min sem uso`, 'info');
  });

  const nav = NAV.filter((n) => !n.cap || can(n.cap));
  const mobileNav = [...nav.filter((n) => n.mobile && n.to !== '/configuracoes').slice(0, 4), NAV[NAV.length - 1]];

  const refresh = async () => {
    setSpin(true);
    await reload();
    setSpin(false);
  };

  return (
    <div className="min-h-dvh lg:pl-64">
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
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {nav.map(({ to, label, icon: Icon }) => (
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
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line pt-4">
          <div className="text-muted flex items-center gap-2 px-2 text-xs">
            {cloud ? <Cloud size={14} className="shrink-0 text-emerald-500" /> : <HardDrive size={14} className="shrink-0 text-amber-500" />}
            <span className="truncate">{cloud ? profile?.email ?? session?.user.email : 'Modo local (sem login)'}</span>
          </div>
          {cloud && (
            <div className="mt-2 px-2">
              <Badge tone="violet">{ROLE_LABEL[role]}</Badge>
            </div>
          )}
          <div className="mt-3 flex gap-1">
            <button onClick={() => setDark(!dark)} className="text-muted rounded-lg p-2 hover:bg-hover" title="Alternar tema">
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button onClick={refresh} className="text-muted rounded-lg p-2 hover:bg-hover" title="Recarregar dados">
              <RefreshCw size={16} className={spin ? 'animate-spin' : ''} />
            </button>
            {cloud && session && (
              <button onClick={signOut} className="text-muted rounded-lg p-2 hover:bg-hover" title="Sair">
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>

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
          {cloud && session && (
            <button onClick={signOut} className="text-muted rounded-lg p-2 hover:bg-hover" aria-label="Sair">
              <LogOut size={16} />
            </button>
          )}
        </div>
      </header>

      {!cloud && (
        <div className="bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-800 dark:text-amber-200">
          Modo local: sem login e sem segurança. Os dados ficam só neste navegador. Para produção, configure o Supabase em Configurações.
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pb-10">{children}</main>

      <nav
        className="card fixed inset-x-0 bottom-0 z-30 grid rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] lg:hidden"
        style={{ gridTemplateColumns: `repeat(${mobileNav.length}, minmax(0, 1fr))` }}
      >
        {mobileNav.map(({ to, short, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => cx('flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium', isActive ? 'text-brand dark:text-indigo-300' : 'text-faint')}
          >
            <Icon size={20} />
            {short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
