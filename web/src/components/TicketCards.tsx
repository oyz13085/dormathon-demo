/* Hallmark · component: ticket-card · genre: modern-minimal · theme: existing system (theme.ts)
 * states: default · hover · focus · active · disabled(n/a, actions own it) · loading(n/a) · error(n/a) · success(n/a)
 * contrast: pass (46–50)
 * Hallmark · pre-emit critique: P5 H5 E4 S5 R4 V4
 */
import { useState, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { theme } from '../theme';
import type { Ticket } from '../api/types';
import { StatusPill } from './StatusPill';
import { Empty, Modal, PRIORITY_COLOR, RiskBadge, SearchBox, TabPills, Toolbar, fmtDate, hours } from './ui';

type Tab = 'All' | 'Open' | 'Unassigned' | 'In progress' | 'Waiting' | 'Closed';

interface Props {
  tickets: Ticket[];
  actions?: (t: Ticket) => ReactNode;
  tabs?: Tab[];
}

// One idea per line: title → when → what-next. Everything else lives
// behind the expander. At-risk tickets group first, rest sort by deadline.
export function TicketCards({ tickets, actions, tabs = ['Open', 'In progress', 'Waiting', 'Closed', 'All'] }: Props) {
  const [tab, setTab] = useState<Tab>(tabs[0]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Ticket | null>(null);

  const filtered = tickets
    .filter(t => inTab(t, tab))
    .filter(t => `${t.title} ${t.division} ${t.requester} ${t.category ?? ''}`.toLowerCase()
      .includes(search.toLowerCase()));
  const urgent = filtered.filter(t => t.alert).sort(byDeadline);
  const rest = filtered.filter(t => !t.alert).sort(byDeadline);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Toolbar>
        <TabPills tabs={tabs} value={tab} onChange={setTab} counts={Object.fromEntries(tabs.map(t => [t, tickets.filter(x => inTab(x, t)).length]))} />
        <SearchBox value={search} onChange={setSearch} placeholder="Search tickets…" />
      </Toolbar>

      {filtered.length === 0 && <Empty>No tickets here.</Empty>}
      {urgent.length > 0 && (
        <Group label="Needs attention" tone={theme.colors.red}>
          {urgent.map(t => <Tile key={t.id} t={t} actions={actions} onDetails={() => setSelected(t)} />)}
        </Group>
      )}
      {rest.length > 0 && (
        <Group label={urgent.length > 0 ? 'Rest of queue' : 'Queued'}>
          {rest.map(t => <Tile key={t.id} t={t} actions={actions} onDetails={() => setSelected(t)} />)}
        </Group>
      )}
      {selected && (
        <Modal title={`#${selected.id} ${selected.title}`} onClose={() => setSelected(null)}>
          <Details t={selected} />
        </Modal>
      )}
    </div>
  );
}

function inTab(t: Ticket, tab: Tab): boolean {
  return tab === 'All' || (tab === 'Open' ? t.status !== 'Closed'
    : tab === 'Unassigned' ? (!t.assignee_id && t.status !== 'Closed') : t.status === tab);
}

function byDeadline(a: Ticket, b: Ticket): number {
  return (a.deadline ?? '').localeCompare(b.deadline ?? '');
}

function Group({ label, tone, children }: { label: string; tone?: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: tone ?? theme.colors.grey,
        textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</h3>
      <div className="fq-cards" style={{ ['--min' as string]: '300px' }}>
        {children}
      </div>
    </section>
  );
}

function Tile({ t, actions, onDetails }: {
  t: Ticket; actions?: (t: Ticket) => ReactNode; onDetails: () => void;
}) {
  const loudRisk = t.alert || (t.p_miss ?? 0) >= 0.3;
  const [hover, setHover] = useState(false);

  return (
    <article onClick={onDetails} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{
      background: theme.colors.card, border: `1.5px solid ${hover ? theme.colors.accent : t.alert ? theme.colors.red + '55' : theme.colors.track}`,
      borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
      cursor: 'pointer', boxShadow: hover ? theme.shadow : 'none',
      transition: 'border-color 0.15s, box-shadow 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <StatusPill status={t.status} />
        <span style={{ fontSize: 11, color: theme.colors.grey, whiteSpace: 'nowrap' }}>#{t.id}</span>
        {t.alert && <AlertCircle size={14} color={theme.colors.red} strokeWidth={2} />}
      </div>

      <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: theme.colors.ink, lineHeight: 1.35,
        overflowWrap: 'anywhere', minWidth: 0 }}>{t.title}</h4>

      <p style={{ margin: 0, fontSize: 12, color: theme.colors.grey }}>
        Due <strong style={{ color: t.alert ? theme.colors.red : theme.colors.ink }}>{fmtDate(t.deadline)}</strong>
        {' · '}{t.pred_likely}h est.
        {' · '}<span style={{ color: PRIORITY_COLOR[t.priority], fontWeight: 700 }}>{t.priority}</span>
        {t.status !== 'Closed' && loudRisk && <>{' · '}<RiskBadge p={t.p_miss} /></>}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
        {actions && <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}
          onClick={e => e.stopPropagation()}>{actions(t)}</span>}
      </div>
    </article>
  );
}

function Details({ t }: { t: Ticket }) {
  const meta: [string, ReactNode][] = [
    ['Status', t.status],
    ['Priority', t.priority],
    ['Due', fmtDate(t.deadline)],
    ['Estimate', hours(t.pred_low, t.pred_likely, t.pred_high)],
    ['Requester', t.requester],
    ['Department', t.division],
    ...(t.category ? [['Category', t.category] as [string, ReactNode]] : []),
    ...(t.deliverable_count ? [['Files', String(t.deliverable_count)] as [string, ReactNode]] : []),
    ...(t.expected_completion ? [['Expected done', fmtDate(t.expected_completion)] as [string, ReactNode]] : []),
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13, lineHeight: 1.6 }}>
      {t.description && (
        <p style={{ margin: 0, fontSize: 14, color: theme.colors.ink }}>{t.description}</p>
      )}

      {t.explanation && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start',
          background: (t.alert ? theme.colors.red : theme.colors.sand) + '10',
          borderRadius: 10, padding: '10px 12px' }}>
          <AlertCircle size={15} color={t.alert ? theme.colors.red : theme.colors.sand}
            strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ margin: 0, color: theme.colors.ink }}>{t.explanation}</p>
        </div>
      )}

      {!!t.facts?.length && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex',
          flexDirection: 'column', gap: 4, color: theme.colors.grey, fontSize: 12 }}>
          {t.facts.map((f, i) => <li key={i} style={{ paddingLeft: 12, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 0, color: theme.colors.accent }}>·</span>{f}
          </li>)}
        </ul>
      )}

      {(t.cause || t.action) && (
        <p style={{ margin: 0, fontSize: 12, color: theme.colors.grey }}>
          {t.cause && <>Cause: <span style={{ color: theme.colors.ink }}>{t.cause}</span></>}
          {t.cause && t.action && ' · '}
          {t.action && <>Next: <span style={{ color: theme.colors.ink }}>{t.action}</span></>}
        </p>
      )}

      <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', margin: 0,
        borderTop: `1px solid ${theme.colors.track}`, paddingTop: 12 }}>
        {meta.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <dt style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.05em', color: theme.colors.grey }}>{k}</dt>
            <dd style={{ margin: 0, fontSize: 13, fontWeight: 600, color: theme.colors.ink }}>{v}</dd>
          </div>
        ))}
      </dl>

      {t.confidence === 'Low' && t.status !== 'Closed' && (
        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: theme.colors.sand }}>
          New ticket type: lead decides
        </p>
      )}
    </div>
  );
}
