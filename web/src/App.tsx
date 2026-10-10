import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { RotateCw } from 'lucide-react';
import { theme } from './theme';
import { SessionProvider, useSession } from './session';
import type { Role } from './api/types';

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
    <header style={{
      position: 'sticky', top: 0, zIndex: 100, background: theme.colors.card,
      borderBottom: `1px solid ${theme.colors.track}`, boxShadow: '0 1px 4px rgba(35,37,43,0.05)',
      padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
    }}>
      <Link to={NAV[role][0].path} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: theme.colors.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 13 }}>FQ</span>
        </span>
        <span style={{ fontWeight: 700, fontSize: 15, color: theme.colors.ink }}>FairQueue</span>
      </Link>

      <nav style={{ display: 'flex', gap: 4, flex: 1, flexWrap: 'wrap' }}>
        {NAV[role].map(n => {
          const active = location.pathname === n.path;
          return (
            <Link key={n.path} to={n.path} style={{
              padding: '5px 12px', borderRadius: theme.radius.pill, fontSize: 13, fontWeight: 600, textDecoration: 'none',
              background: active ? theme.colors.ink : 'transparent', color: active ? '#fff' : theme.colors.grey,
            }}>{n.label}</Link>
          );
        })}
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: theme.colors.grey }}>Demo role</span>
        {(['requester', 'analyst', 'lead'] as Role[]).map(r => (
          <button key={r} onClick={() => { setRole(r); navigate(NAV[r][0].path); }} style={{
            padding: '4px 11px', borderRadius: theme.radius.pill, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: role === r ? theme.colors.accent : theme.colors.track, color: role === r ? '#fff' : theme.colors.grey,
          }}>{ROLE_LABEL[r]}</button>
        ))}
        {identities.length > 0 && (
          <select value={user} onChange={e => setUser(e.target.value)} aria-label="Who are you?" style={{
            padding: '4px 8px', borderRadius: 8, border: `1.5px solid ${theme.colors.track}`, fontSize: 12, background: theme.colors.card,
          }}>
            {identities.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
          </select>
        )}
        <button onClick={refresh} title="Reload data" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
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
      <main style={{ flex: 1, maxWidth: 1440, width: '100%', margin: '0 auto', padding: 24 }}>
        <Routes>
          <Route path="/" element={<Navigate to={NAV[role][0].path} replace />} />
          <Route path="/requester/new" element={<NewTicket />} />
          <Route path="/requester/tickets" element={<MyTickets />} />
          <Route path="/requester/completed" element={<CompletedWork />} />
          <Route path="/analyst/queue" element={<Queue />} />
          <Route path="/analyst/work" element={<MyWork />} />
          <Route path="/analyst/new" element={<NewTicket />} />
          <Route path="/analyst/requested" element={<><MyTickets /><div style={{ height: 16 }} /><CompletedWork /></>} />
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
