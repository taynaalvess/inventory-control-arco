export type Mode = 'local' | 'supabase';

export interface AppConfig {
  mode: Mode;
  supabaseUrl: string;
  supabaseKey: string;
}

const KEY = 'arco.config';
const envUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

/**
 * Quando o build recebe as variáveis do Supabase (GitHub Actions), o site fica TRAVADO no modo nuvem:
 * não existe modo local nem como apontar para outro banco — sempre exige login.
 */
export const hasEnvSupabase = Boolean(envUrl && envKey);

const envConfig: AppConfig = { mode: 'supabase', supabaseUrl: envUrl, supabaseKey: envKey };

export function loadConfig(): AppConfig {
  if (hasEnvSupabase) return envConfig;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { mode: 'local', supabaseUrl: '', supabaseKey: '', ...(JSON.parse(raw) as Partial<AppConfig>) };
  } catch {
    /* armazenamento indisponível */
  }
  return { mode: 'local', supabaseUrl: '', supabaseKey: '' };
}

export function saveConfig(c: AppConfig) {
  if (hasEnvSupabase) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignora */
  }
}

export const isCloudReady = (c: AppConfig) => c.mode === 'supabase' && Boolean(c.supabaseUrl && c.supabaseKey);
