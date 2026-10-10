import { useEffect, useId, useRef, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import { theme } from '../theme';

// Padding shrinks on small windows (--fq-pad in index.css), so cards keep their room for content
export const card: CSSProperties = {
  background: theme.colors.card, borderRadius: theme.radius.card,
  padding: 'var(--fq-pad)', boxShadow: theme.shadow, minWidth: 0,
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
          <h2 style={{ margin: 0, fontSize: theme.font.title, fontWeight: 600, color: theme.colors.ink, flex: '1 1 180px', minWidth: 0 }}>{title}</h2>
          {right && <div style={{ flex: '0 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{right}</div>}
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

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Escape closes, Tab stays inside, and focus goes back to whatever opened the dialog
export function Modal({ title, onClose, children, width = 560, centered }: {
  title: string; onClose: () => void; children: ReactNode; width?: number; centered?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0], last = items[items.length - 1];
      if (!first) { e.preventDefault(); return; }
      if (!dialog.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  return (
    <div onClick={onClose} className="fq-modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(35,37,43,0.35)', zIndex: 200,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: centered ? '24px 16px' : '60px 16px', overflowY: 'auto' }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={e => e.stopPropagation()}
        style={{ ...card, width: '100%', maxWidth: width, margin: centered ? 'auto' : undefined }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <h2 id={titleId} style={{ margin: 0, fontSize: 17, flex: 1 }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0 }}>
            <X size={18} color={theme.colors.grey} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const sectionHeading: CSSProperties = { margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: theme.colors.grey };

// Small grey heading for a section inside a modal
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 style={sectionHeading}>{children}</h3>;
}

// One label/value pair inside a <dl>
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt style={sectionHeading}>{label}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
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

// Cards stretch to fill the row; ticket grids keep a fixed card width so one ticket doesn't fill the page
export const cardGrid = (min: number, stretch = true) => ({
  display: 'grid', gridTemplateColumns: `repeat(${stretch ? 'auto-fit' : 'auto-fill'}, minmax(${min}px, 1fr))`, gap: 12,
});

export function StatTile({ icon: Icon, color, label, value, hint }: { icon: ElementType; color: string; label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="fq-stat" style={{ borderRadius: 16, background: color + '10', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: color + '22', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={15} color={color} strokeWidth={2} />
        </span>
        <span style={{ fontSize: 12, color: theme.colors.grey, fontWeight: 500, lineHeight: 1.3 }}>{label}</span>
      </div>
      <div className="fq-stat-value" style={{ fontWeight: 700, lineHeight: 1, color: theme.colors.ink }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: theme.colors.grey }}>{hint}</div>}
    </div>
  );
}

// ── Page building blocks shared by every screen (the dashboard / assign look) ──

/** A row of StatTiles: as many per row as fit, two per row on a phone. */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="fq-stat-row">{children}</div>;
}

/** Vertical stack of cards with the standard gap. */
export function Page({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.gap, minWidth: 0 }}>{children}</div>;
}

/** Grey helper text for a card's right-hand slot. */
export function Hint({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 11, color: theme.colors.grey, lineHeight: 1.4 }}>{children}</span>;
}

/** Row of highlight cards that share the width equally and stack when narrow. */
export function HighlightRow({ children }: { children: ReactNode }) {
  return <div className="fq-highlights">{children}</div>;
}

/** One headline finding: icon chip, small caps title, one sentence. Coloured left edge. */
export function Highlight({ icon: Icon, color, title, children, onClick }: {
  icon: ElementType; color: string; title: string; children: ReactNode; onClick?: () => void;
}) {
  const body = (
    <>
      <span style={{ width: 38, height: 38, borderRadius: 11, background: color + '18', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={16} color={color} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: theme.colors.grey, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}</div>
        <div style={{ fontSize: 14, marginTop: 4, lineHeight: 1.45 }}>{children}</div>
      </div>
      {onClick && <ChevronRight size={15} color={theme.colors.grey} style={{ alignSelf: 'center', flexShrink: 0 }} />}
    </>
  );
  const style: CSSProperties = { display: 'flex', gap: 14, padding: '18px 20px', borderRadius: theme.radius.card, border: 'none', boxShadow: theme.shadow,
    background: theme.colors.card, textAlign: 'left', fontFamily: 'inherit', color: theme.colors.ink, borderLeft: `4px solid ${color}`, minWidth: 0 };
  return onClick
    ? <button onClick={onClick} className="fq-lift" style={{ ...style, cursor: 'pointer' }}>{body}</button>
    : <div style={style}>{body}</div>;
}

/** Ink pill tabs with an optional count. */
export function TabPills<T extends string>({ tabs, value, onChange, counts }: {
  tabs: readonly T[]; value: T; onChange: (t: T) => void; counts?: Partial<Record<T, number>>;
}) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {tabs.map(t => (
        <button key={t} role="tab" aria-selected={value === t} onClick={() => onChange(t)} style={{
          padding: '6px 14px', borderRadius: theme.radius.pill, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
          background: value === t ? theme.colors.ink : theme.colors.track, color: value === t ? '#fff' : theme.colors.ink, whiteSpace: 'nowrap',
        }}>{t}{counts?.[t] !== undefined && <span style={{ opacity: 0.6 }}> {counts[t]}</span>}</button>
      ))}
    </div>
  );
}

/** Search input with a clear button; grows to fill the toolbar on small windows. */
export function SearchBox({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="fq-search" style={{ position: 'relative' }}>
      <Search size={14} color={theme.colors.grey} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        style={{ ...inputStyle, paddingLeft: 32, paddingRight: 32 }} />
      {value && (
        <button onClick={() => onChange('')} aria-label="Clear search" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          width: 22, height: 22, borderRadius: '50%', border: 'none', background: theme.colors.track, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/** Tabs on the left, search (and anything else) on the right; wraps on small windows. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="fq-toolbar">{children}</div>;
}

/** Small grey tile with a label, a bold value and a sub line. */
export function MiniStat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div style={{ padding: '10px 14px', borderRadius: 12, background: theme.colors.background, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: theme.colors.grey }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: theme.colors.grey }}>{sub}</div>}
    </div>
  );
}

/** Pill showing a department filter that's on, with a way to clear it. */
export function FilterChip({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <button onClick={onClear} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: theme.radius.pill,
      border: 'none', background: theme.colors.track, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: theme.colors.ink, fontFamily: 'inherit' }}>
      {children} <X size={12} />
    </button>
  );
}
