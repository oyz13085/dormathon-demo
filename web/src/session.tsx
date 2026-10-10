import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './api/client';
import type { Dept, Meta, Role } from './api/types';

// Demo identity: the role selector at the top of the app. A real version would use the company login.
interface Session {
  meta: Meta | null;
  role: Role;
  user: string;                 // requester name, or analyst name
  analystId: number | null;     // set when role is analyst
  division: Dept | null;        // lead's department filter
  setRole: (r: Role) => void;
  setUser: (u: string) => void;
  setDivision: (d: Dept | null) => void;
  refreshKey: number;           // bump to make every page reload its data
  refresh: () => void;
}

const Ctx = createContext<Session | null>(null);

const DEFAULT_USER: Record<Role, string> = { requester: 'Nurul Huda', analyst: 'Ravi', lead: 'Team lead' };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [roleState, setRoleState] = useState<Role>('lead');
  // The URL decides the role, so deep links and reloads land in the right view
  const pathRole = useLocation().pathname.split('/')[1] as Role;
  const role: Role = (['requester', 'analyst', 'lead'] as Role[]).includes(pathRole) ? pathRole : roleState;
  const [users, setUsers] = useState<Record<Role, string>>(DEFAULT_USER);
  const [division, setDivision] = useState<Dept | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { api.get<Meta>('/meta').then(setMeta).catch(() => setMeta(null)); }, [refreshKey]);

  const user = users[role];
  const analystId = role === 'analyst' ? meta?.analysts.find(a => a.name === user)?.id ?? null : null;
  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  return (
    <Ctx.Provider value={{
      meta, role, user, analystId, division,
      setRole: setRoleState,
      setUser: (u: string) => setUsers(prev => ({ ...prev, [role]: u })),
      setDivision, refreshKey, refresh,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

/** Load JSON from the API; reloads when `path` changes or the session refreshes. */
export function useApi<T>(path: string | null) {
  const { refreshKey } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    api.get<T>(path)
      .then(d => { if (live) { setData(d); setError(null); } })
      .catch(e => { if (live) setError(String(e.message ?? e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, refreshKey, tick]);

  return { data, error, loading, reload: () => setTick(t => t + 1) };
}
