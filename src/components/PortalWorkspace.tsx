'use client';

import { useState } from 'react';
import ApiTester from './ApiTester';
import ApiLogsTable from './ApiLogsTable';
import type { ApiRequestLog } from '@prisma/client';

export default function PortalWorkspace({ initialLogs }: { initialLogs: ApiRequestLog[] }) {
  const [activeTab, setActiveTab] = useState<'tester' | 'logs'>('tester');

  return (
    <div className="flex h-[calc(100vh-69px)] w-full overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Workspace</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          <button
            onClick={() => setActiveTab('tester')}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'tester'
                ? 'bg-cidco-50 text-cidco-700'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.29 7 12 12 20.71 7"></polyline><line x1="12" y1="22" x2="12" y2="12"></line></svg>
            API Tester
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'logs'
                ? 'bg-cidco-50 text-cidco-700'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            API Logs
          </button>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-8">
        {activeTab === 'tester' && <ApiTester />}
        {activeTab === 'logs' && <ApiLogsTable logs={initialLogs} />}
      </main>
    </div>
  );
}
