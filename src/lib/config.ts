export type Mode = 'local' | 'supabase';

export interface AppConfig {
  mode: Mode;
  supabaseUrl: string;
  supabaseKey: string;
}

const KEY = 'arco.config';
const envUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

/** Quando o build recebe as variáveis do Supabase (GitHub Actions), o app já nasce em modo nuvem. */
export const hasEnvSupabase = Boolean(envUrl && envKey);

const defaults: AppConfig = {
  mode: hasEnvSupabase ? 'supabase' : 'local',
  supabaseUrl: envUrl,
  supabaseKey: envKey,
};

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppConfig>;
      return {
        ...defaults,
        ...saved,
        supabaseUrl: saved.supabaseUrl || defaults.supabaseUrl,
        supabaseKey: saved.supabaseKey || defaults.supabaseKey,
      };
    }
  } catch {
    /* armazenamento indisponível */
  }
  return defaults;
}

export function saveConfig(c: AppConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignora */
  }
}

export const isCloudReady = (c: AppConfig) => c.mode === 'supabase' && Boolean(c.supabaseUrl && c.supabaseKey);
