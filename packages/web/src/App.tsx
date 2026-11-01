import { useCallback, useEffect, useState } from 'react';
import { api, type RunRow, type RunStatus } from './api.ts';
import { NewRun } from './NewRun.tsx';
import { RunView } from './RunView.tsx';

type Route = { name: 'new' } | { name: 'run'; id: string };

function parseHash(): Route {
  const m = /^#\/runs\/([\w.-]+)/.exec(window.location.hash);
  return m ? { name: 'run', id: m[1]! } : { name: 'new' };
}

export const navigate = (hash: string) => {
  window.location.hash = hash;
};

const STATUS_MARK: Record<RunStatus, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'text-ink-faint' },
  running: { label: 'Running', className: 'text-active' },
  succeeded: { label: 'Done', className: 'text-pass' },
  failed: { label: 'Failed', className: 'text-pencil' },
};

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [provider, setProvider] = useState<string | null>(null);
  const [apiDown, setApiDown] = useState(false);

  const refreshRuns = useCallback(() => {
    api
      .listRuns()
      .then((r) => {
        setRuns(r);
        setApiDown(false);
      })
      .catch(() => setApiDown(true));
  }, []);

  // Show in the browser tab that a run is blocked on a person.
  const waitingRuns = runs.filter((r) => (r.pendingQuestions ?? 0) > 0).length;
  useEffect(() => {
    document.title = waitingRuns ? `(${waitingRuns}) Answer needed | Post Recipe` : 'Post Recipe';
  }, [waitingRuns]);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    api.health().then((h) => setProvider(h.provider)).catch(() => setApiDown(true));
    refreshRuns();
    const t = setInterval(refreshRuns, 4000);
    return () => {
      window.removeEventListener('hashchange', onHash);
      clearInterval(t);
    };
  }, [refreshRuns]);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[17rem_1fr]">
      <aside className="border-b border-rule bg-desk-deep/60 md:min-h-screen md:border-r md:border-b-0">
        <div className="flex items-baseline justify-between px-5 pt-6 pb-4">
          <a href="#/" className="font-wide text-lg font-bold tracking-tight">
            Post Recipe
          </a>
          {provider && (
            <span className={`text-xs ${provider === 'mock' ? 'text-amber' : 'text-ink-faint'}`} title="AI provider configured on the server">
              {provider === 'mock' ? 'Mock AI' : 'OpenAI'}
            </span>
          )}
        </div>
        <div className="px-3 pb-3">
          <a
            href="#/"
            className={`block rounded-md px-3 py-2 text-sm font-semibold ${route.name === 'new' ? 'bg-ink text-paper' : 'hover:bg-desk'}`}
          >
            New run
          </a>
        </div>
        <nav aria-label="Runs" className="max-h-64 overflow-y-auto px-3 pb-6 md:max-h-none">
          {apiDown && <p className="px-3 py-2 text-sm text-pencil">API not reachable. Start it with pnpm dev:server.</p>}
          {!apiDown && runs.length === 0 && <p className="px-3 py-2 text-sm text-ink-faint">No runs yet.</p>}
          <ul className="space-y-0.5">
            {runs.map((r) => {
              const active = route.name === 'run' && route.id === r.id;
              const waiting = (r.pendingQuestions ?? 0) > 0;
              const mark = waiting ? { label: 'Needs your answer', className: 'font-semibold text-pencil' } : STATUS_MARK[r.status];
              return (
                <li key={r.id}>
                  <a href={`#/runs/${r.id}`} className={`block rounded-md px-3 py-2 ${active ? 'bg-paper shadow-[0_1px_0_var(--color-rule)]' : 'hover:bg-desk'}`}>
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {waiting && <span className="size-2 rounded-full bg-pencil" aria-hidden />}
                      <span className="truncate" title={r.title ?? r.brandSlug}>
                        {r.title ?? r.brandSlug}
                      </span>
                    </span>
                    <span className="flex justify-between gap-2 text-xs text-ink-soft">
                      <span className="truncate">
                        {r.title && `${r.brandSlug}, `}
                        {formatTime(r.createdAt)}
                      </span>
                      <span className={mark.className}>{mark.label}</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-10 md:py-8">
        {route.name === 'new' ? (
          <NewRun
            onCreated={(id) => {
              refreshRuns();
              navigate(`#/runs/${id}`);
            }}
          />
        ) : (
          <RunView key={route.id} runId={route.id} onChanged={refreshRuns} />
        )}
      </main>
    </div>
  );
}
