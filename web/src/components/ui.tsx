import { useEffect, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { theme } from '../theme';

export const card: CSSProperties = {
  background: theme.colors.card, borderRadius: theme.radius.card,
  padding: theme.space.pad, boxShadow: theme.shadow,
};

export function Card({ title, icon: Icon, iconColor, right, children, style }: {
  title?: ReactNode; icon?: ElementType; iconColor?: string; right?: ReactNode;
  children: ReactNode; style?: CSSProperties;
}) {
  return (
    <section style={{ ...card, ...style }}>
      {(title || right) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {Icon && (
            <span style={{ width: 26, height: 26, borderRadius: 7, background: (iconColor ?? theme.colors.grey) + '20',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon size={13} color={iconColor ?? theme.colors.grey} strokeWidth={1.5} />
            </span>
          )}
          <h2 style={{ margin: 0, fontSize: theme.font.title, fontWeight: 600, color: theme.colors.ink, flex: 1 }}>{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';

export function Button({ children, onClick, variant = 'primary', disabled, type = 'button', small, title }: {
  children: ReactNode; onClick?: () => void; variant?: Variant; disabled?: boolean;
  type?: 'button' | 'submit'; small?: boolean; title?: string;
}) {
  const styles: Record<Variant, CSSProperties> = {
    primary: { background: theme.colors.ink, color: '#fff', border: 'none' },
    outline: { background: 'transparent', color: theme.colors.ink, border: `1.5px solid ${theme.colors.ink}` },
    ghost: { background: theme.colors.track, color: theme.colors.ink, border: 'none' },
    danger: { background: 'transparent', color: theme.colors.red, border: `1.5px solid ${theme.colors.red}` },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} style={{
      ...styles[variant], display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: small ? '4px 12px' : '8px 18px', borderRadius: theme.radius.pill,
      fontSize: small ? 12 : 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
    }}>{children}</button>
  );
}

export const inputStyle: CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 10, border: `1.5px solid ${theme.colors.track}`,
  fontSize: 13, outline: 'none', background: theme.colors.card, color: theme.colors.ink, fontFamily: 'inherit',
};

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.grey }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: theme.colors.grey }}>{hint}</span>}
    </label>
  );
}

export function Pill({ children, color = theme.colors.grey, solid }: { children: ReactNode; color?: string; solid?: boolean }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: theme.radius.pill, fontSize: 11, fontWeight: 600,
      background: solid ? color : color + '18', color: solid ? '#fff' : color, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'error' | 'ok' }) {
  const c = { info: theme.colors.ink, warn: theme.colors.sand, error: theme.colors.red, ok: theme.colors.sage }[tone];
  return (
    <div style={{ padding: '10px 14px', borderRadius: 12, background: c + '12', border: `1px solid ${c}40`,
      fontSize: 13, color: theme.colors.ink, lineHeight: 1.5 }}>{children}</div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, padding: '18px 0', textAlign: 'center', fontSize: 13, color: theme.colors.grey }}>{children}</p>;
}

export function Loading({ error }: { error?: string | null }) {
  return error
    ? <Notice tone="error">Couldn't load this: {error}. Is the backend running on {import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}?</Notice>
    : <Empty>Loading…</Empty>;
}

export function Modal({ title, onClose, children, width = 560 }: {
  title: string; onClose: () => void; children: ReactNode; width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(35,37,43,0.35)', zIndex: 200,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: width }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 17, flex: 1 }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={18} color={theme.colors.grey} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>{head.map((h, i) => (
            <th key={i} style={{ padding: '8px 10px', textAlign: 'left', color: theme.colors.grey, fontWeight: 500,
              fontSize: 12, borderBottom: `1.5px solid ${theme.colors.track}`, whiteSpace: 'nowrap' }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const td: CSSProperties = { padding: '9px 10px', verticalAlign: 'top', borderBottom: `1px solid ${theme.colors.track}` };

export const PRIORITY_COLOR: Record<string, string> = {
  Critical: theme.colors.red, High: theme.colors.accent, Medium: theme.colors.sand, Low: theme.colors.grey,
};

export function RiskBadge({ p }: { p?: number | null }) {
  if (p === undefined || p === null) return <span style={{ color: theme.colors.grey }}>—</span>;
  const color = p >= 0.5 ? theme.colors.red : p >= 0.3 ? theme.colors.sand : theme.colors.sage;
  return <Pill color={color}>{Math.round(p * 100)}% miss</Pill>;
}

export function fmtDate(s?: string | null): string {
  if (!s) return '—';
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s.replace(' ', 'T'));
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function hours(low?: number, likely?: number, high?: number): ReactNode {
  if (likely === undefined || likely === null) return '—';
  return <span><strong>{likely}h</strong> <span style={{ color: theme.colors.grey, fontSize: 11 }}>({low}–{high})</span></span>;
}

export function initials(name?: string | null): string {
  return (name ?? '?').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

export function Grid({ cols, children, gap = theme.space.gap }: { cols: string; children: ReactNode; gap?: number }) {
  return <div className="fq-grid" style={{ display: 'grid', gridTemplateColumns: cols, gap, alignItems: 'start' }}>{children}</div>;
}
