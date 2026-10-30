import { useEffect, useState } from 'react';

type Health = 'checking' | 'ok' | 'down';

export function App() {
  const [health, setHealth] = useState<Health>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { ok?: boolean }) => setHealth(body.ok ? 'ok' : 'down'))
      .catch(() => setHealth('down'));
  }, []);

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-3xl font-bold tracking-tight">AI Recipe — Instagram posts</h1>
        <p className="mt-3 text-neutral-600">
          From an Instagram brand to three finished posts. The pipeline UI arrives in a later milestone.
        </p>
        <p className="mt-6 text-sm">
          API status:{' '}
          <span className={health === 'ok' ? 'text-green-700' : health === 'down' ? 'text-red-700' : 'text-neutral-500'}>
            {health}
          </span>
        </p>
      </div>
    </main>
  );
}
