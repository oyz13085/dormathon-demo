import { Search } from 'lucide-react';
import { theme } from '../theme';

// Tabs on the left, optional search on the right; shared by the ticket table and the card grids
export function TicketFilters<T extends string>({ tabs, tab, onTab, counts, search, onSearch }: {
  tabs: T[]; tab: T; onTab: (t: T) => void; counts?: Partial<Record<T, number>>;
  search?: string; onSearch?: (s: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {tabs.map(t => (
        <button key={t} onClick={() => onTab(t)} aria-pressed={tab === t} style={{
          padding: '5px 14px', borderRadius: theme.radius.pill, border: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: 600,
          background: tab === t ? theme.colors.ink : theme.colors.track,
          color: tab === t ? '#fff' : theme.colors.grey,
        }}>
          {t}{counts?.[t] !== undefined && <span style={{ marginLeft: 6, opacity: 0.7 }}>{counts[t]}</span>}
        </button>
      ))}
      {onSearch && (
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <Search size={14} color={theme.colors.grey} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={search ?? ''} onChange={e => onSearch(e.target.value)} placeholder="Search tickets…" aria-label="Search tickets" style={{
            paddingLeft: 32, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: theme.radius.pill,
            border: `1.5px solid ${theme.colors.track}`, fontSize: 13, outline: 'none', background: theme.colors.card, width: 200,
          }} />
        </div>
      )}
    </div>
  );
}
