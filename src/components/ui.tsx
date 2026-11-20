import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { TrendingDown, TrendingUp, X } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('card rounded-2xl p-4 sm:p-5', className)}>{children}</div>;
}

export function CardTitle({ children, action, hint }: { children: ReactNode; action?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold">{children}</h3>
        {hint && <p className="text-muted mt-0.5 text-xs">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-600 shadow-sm',
  secondary: 'border border-line bg-surface hover:bg-hover',
  ghost: 'hover:bg-hover',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : size === 'lg' ? 'h-12 px-5 text-base' : 'h-10 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export const inputCls =
  'h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm outline-none transition placeholder:text-faint focus:border-brand focus:ring-4 focus:ring-brand/15';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} {...props} className={cx(inputCls, className)} />;
});

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(inputCls, 'pr-8', className)}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="text-muted mb-1.5 block text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="text-faint mt-1 block text-xs">{hint}</span>}
    </label>
  );
}

type Tone = 'neutral' | 'green' | 'red' | 'amber' | 'blue' | 'violet';
const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  green: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  red: 'bg-rose-500/12 text-rose-700 dark:text-rose-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  blue: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
  violet: 'bg-brand/12 text-brand-600 dark:text-indigo-300',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONES[tone], className)}>{children}</span>;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        className={cx('card flex max-h-[92dvh] w-full flex-col rounded-t-2xl sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="text-muted rounded-lg p-1 hover:bg-hover" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted mt-1 text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Kpi({
  label,
  value,
  hint,
  icon,
  change,
  tone = 'violet',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  change?: number | null;
  tone?: Tone;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-muted text-xs font-medium">{label}</span>
        {icon && <span className={cx('rounded-lg p-1.5', TONES[tone])}>{icon}</span>}
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="flex min-h-5 flex-wrap items-center gap-2 text-xs">
        {change !== undefined && change !== null && (
          <span className={cx('inline-flex items-center gap-1 font-medium', change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
            {change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {(Math.abs(change) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
          </span>
        )}
        {hint && <span className="text-faint">{hint}</span>}
      </div>
    </Card>
  );
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      {icon && <div className="text-faint mb-1">{icon}</div>}
      <p className="font-medium">{title}</p>
      {text && <p className="text-muted max-w-md text-sm">{text}</p>}
      {action && <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="inline-flex flex-wrap rounded-xl border border-line bg-surface p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition',
            value === o.value ? 'bg-brand text-white shadow-sm' : 'text-muted hover:bg-hover',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StockBadge({ stock, min }: { stock: number; min: number }) {
  if (stock <= 0) return <Badge tone="red">{stock}</Badge>;
  if (min > 0 && stock <= min) return <Badge tone="amber">{stock}</Badge>;
  return <Badge tone="green">{stock}</Badge>;
}
