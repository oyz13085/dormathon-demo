import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { RotateCw } from 'lucide-react';
import { theme } from './theme';
import { SessionProvider, useSession } from './session';
import type { Role } from './api/types';
import { Page } from './components/ui';

import NewTicket from './pages/requester/NewTicket';
import MyTickets from './pages/requester/MyTickets';
import CompletedWork from './pages/requester/CompletedWork';
import Queue from './pages/analyst/Queue';
import MyWork from './pages/analyst/MyWork';
import Dashboard from './pages/lead/Dashboard';
import Assign from './pages/lead/Assign';
import LeavePage from './pages/lead/LeaveCalendarPage';
import Library from './pages/lead/Library';
import Results from './pages/lead/Results';
import Settings from './pages/lead/Settings';
import OverrideLog from './pages/lead/OverrideLog';

const NAV: Record<Role, { label: string; path: string }[]> = {
  requester: [
    { label: 'New request', path: '/requester/new' },
    { label: 'Tickets Assigned', path: '/requester/tickets' },
    { label: 'My completed work', path: '/requester/completed' },
  ],
  analyst: [
    { label: 'My queue', path: '/analyst/queue' },
    { label: 'My work & feedback', path: '/analyst/work' },
    { label: 'New request', path: '/analyst/new' },
    { label: 'Tickets I requested', path: '/analyst/requested' },
  ],
  lead: [
    { label: 'Dashboard', path: '/lead/dashboard' },
    { label: 'Assign', path: '/lead/assign' },
    { label: 'Leave & what-if', path: '/lead/leave' },
    { label: 'Deliverables', path: '/lead/library' },
    { label: 'Replay results', path: '/lead/results' },
    { label: 'Override log', path: '/lead/log' },
    { label: 'Fit settings', path: '/lead/settings' },
  ],
};

const ROLE_LABEL: Record<Role, string> = { requester: 'Requester', analyst: 'Analyst', lead: 'Team lead' };

function TopBar() {
  const { role, setRole, user, setUser, meta, refresh } = useSession();
  const location = useLocation();
  const navigate = useNavigate();

  const identities = role === 'requester'
    ? (meta?.requesters ?? []).filter(r => !r.is_analyst).map(r => ({ value: r.name, label: `${r.name} (${r.division})` }))
    : role === 'analyst'
      ? (meta?.analysts ?? []).map(a => ({ value: a.name, label: a.name }))
      : [];

  return (
    <header className="fq-topbar">
      <Link to={NAV[role][0].path} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="fq-brand-name" style={{ fontWeight: 700, fontSize: 15, color: theme.colors.ink }}>FairQueue</span>
      </Link>

      <nav className="fq-nav" aria-label="Pages">
        {NAV[role].map(n => {
          const active = location.pathname === n.path;
          return (
            <Link key={n.path} to={n.path} aria-current={active ? 'page' : undefined} style={{
              padding: '6px 12px', borderRadius: theme.radius.pill, fontSize: 13, fontWeight: 600, textDecoration: 'none',
              background: active ? theme.colors.ink : 'transparent', color: active ? '#fff' : theme.colors.grey,
            }}>{n.label}</Link>
          );
        })}
      </nav>

      <div className="fq-roles">
        <span className="fq-roles-label">Demo role</span>
        <div role="group" aria-label="Demo role" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: theme.radius.pill, background: theme.colors.track }}>
          {(['requester', 'analyst', 'lead'] as Role[]).map(r => (
            <button key={r} onClick={() => { setRole(r); navigate(NAV[r][0].path); }} aria-pressed={role === r} style={{
              padding: '4px 11px', borderRadius: theme.radius.pill, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              background: role === r ? theme.colors.accent : 'transparent', color: role === r ? '#fff' : theme.colors.grey, whiteSpace: 'nowrap',
            }}>{ROLE_LABEL[r]}</button>
          ))}
        </div>
        {identities.length > 0 && (
          <select value={user} onChange={e => setUser(e.target.value)} aria-label="Who are you?" style={{
            padding: '5px 8px', borderRadius: 10, border: `1.5px solid ${theme.colors.track}`, fontSize: 12, background: theme.colors.card,
            fontFamily: 'inherit', color: theme.colors.ink, minWidth: 177,
          }}>
            {identities.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
          </select>
        )}
        <button onClick={refresh} title="Reload data" aria-label="Reload data" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
          <RotateCw size={15} color={theme.colors.grey} />
        </button>
      </div>
    </header>
  );
}

function AppRoutes() {
  const { role } = useSession();
  return (
    <>
      <TopBar />
      <main className="fq-main">
        <Routes>
          <Route path="/" element={<Navigate to={NAV[role][0].path} replace />} />
          <Route path="/requester/new" element={<NewTicket />} />
          <Route path="/requester/tickets" element={<MyTickets />} />
          <Route path="/requester/completed" element={<CompletedWork />} />
          <Route path="/analyst/queue" element={<Queue />} />
          <Route path="/analyst/work" element={<MyWork />} />
          <Route path="/analyst/new" element={<NewTicket />} />
          <Route path="/analyst/requested" element={<Page><MyTickets /><CompletedWork /></Page>} />
          <Route path="/lead/dashboard" element={<Dashboard />} />
          <Route path="/lead/assign" element={<Assign />} />
          <Route path="/lead/leave" element={<LeavePage />} />
          <Route path="/lead/library" element={<Library />} />
          <Route path="/lead/results" element={<Results />} />
          <Route path="/lead/log" element={<OverrideLog />} />
          <Route path="/lead/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to={NAV[role][0].path} replace />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <AppRoutes />
      </SessionProvider>
    </BrowserRouter>
  );
}
