'use client';

import { useCallback, useEffect, useState } from 'react';
import ArchitectSignIn, { type Architect } from './ArchitectSignIn';
import ConnectionPanel from './ConnectionPanel';
import SendDataPanel from './SendDataPanel';
import MyReadingsPanel from './MyReadingsPanel';
import ActivityPanel from './ActivityPanel';
import { useTokens } from './useTokens';

export type MeData = {
  architect: { id: string; name: string; email: string; firmName: string | null };
  handshakes: Array<{
    id: string;
    clientId: string;
    status: string;
    credentialExpiresAt: string;
    establishedAt: string | null;
    whitelistedIp: string | null;
    deviceInfo: string | null;
    enforceWhitelist: boolean;
    accessTokenTtlDays: number;
    refreshTokenTtlDays: number;
    liveToken: { prefix: string; refreshPrefix: string | null; expiresAt: string; refreshExpiresAt: string | null } | null;
    commLogs: Array<{
      id: string; direction: string; event: string; statusCode: number | null;
      detail: string | null; ip: string | null; createdAt: string;
    }>;
  }>;
  readingCount: number;
  recentReadings: Array<{
    id: string; referenceNo: string; projectSiteId: string | null; monitoringStationId: string | null;
    siteName: string; measuredAt: string; aqiValue: number; pm25: number | null; pm10: number | null;
    temperature: number | null; humidity: number | null; source: string; status: string; receivedAt: string;
  }>;
};

type Tab = 'connection' | 'send' | 'readings' | 'activity';

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}

export default function ArchitectWorkspace() {
  const [me, setMe] = useState<MeData | null>(null);
  const [architect, setArchitect] = useState<Architect | null>(null);
  const [tab, setTab] = useState<Tab>('connection');
  const [checking, setChecking] = useState(true);
  const { tokens, save, clear, loaded } = useTokens();

  const reload = useCallback(async () => {
    const res = await fetch('/api/architect/me');
    if (res.ok) {
      const json = await res.json();
      setMe(json.data);
      setArchitect((prev) => prev ?? { ...json.data.architect, role: 'ARCHITECT' });
    }
  }, []);

  // Resume an existing architect session on load.
  useEffect(() => {
    (async () => {
      await reload();
      setChecking(false);
    })();
  }, [reload]);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setMe(null);
    setArchitect(null);
    setTab('connection');
  }

  if (checking || !loaded) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Loading…</div>;
  }

  if (!me || !architect) {
    return (
      <main className="flex-1 overflow-y-auto p-8">
        <ArchitectSignIn
          onSignedIn={async (a) => {
            setArchitect(a);
            await reload();
          }}
        />
      </main>
    );
  }

  const live = me.handshakes.find((h) => h.status === 'ESTABLISHED');

  return (
    <div className="flex h-[calc(100vh-69px)] w-full overflow-hidden bg-slate-50">
      <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">My integration</p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          <NavButton active={tab === 'connection'} onClick={() => setTab('connection')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"></path></svg>
            Connection
          </NavButton>
          <NavButton active={tab === 'send'} onClick={() => setTab('send')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            Send AQI data
          </NavButton>
          <NavButton active={tab === 'readings'} onClick={() => setTab('readings')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
            My readings
          </NavButton>
          <NavButton active={tab === 'activity'} onClick={() => setTab('activity')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            Activity log
          </NavButton>
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
            <p className="font-medium text-slate-700">
              {live ? 'Channel established' : 'Not established'}
            </p>
            <p className="mt-0.5 text-slate-500">
              {live ? `${live.clientId}` : 'Validate on the Connection tab'}
            </p>
          </div>
          <a href="/docs/architect" target="_blank" rel="noreferrer" className="mb-3 block text-xs font-medium text-emerald-700 hover:underline">
            → API documentation
          </a>
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{architect.name}</p>
              <p className="truncate text-xs text-slate-500">{me.architect.firmName ?? 'Architect'}</p>
            </div>
            <button onClick={signOut} className="text-xs font-semibold text-slate-500 hover:text-slate-900">
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        {tab === 'connection' && (
          <ConnectionPanel me={me} tokens={tokens} saveTokens={save} clearTokens={clear} reload={reload} />
        )}
        {tab === 'send' && <SendDataPanel tokens={tokens} reload={reload} />}
        {tab === 'readings' && <MyReadingsPanel me={me} />}
        {tab === 'activity' && <ActivityPanel me={me} />}
      </main>
    </div>
  );
}
