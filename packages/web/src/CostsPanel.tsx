import { useEffect, useState } from 'react';
import { api, STAGE_TITLES, type AiCall, type CostBucket, type CostReport, type Stage } from './api.ts';

const usd = (n: number) => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function Rows({ title, rows }: { title: string; rows: [string, CostBucket][] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-rule text-left text-ink-soft">
          <th className="py-2 pr-3 font-medium">{title}</th>
          <th className="py-2 pr-3 text-right font-medium">Calls</th>
          <th className="py-2 pr-3 text-right font-medium">Tokens in / out</th>
          <th className="py-2 pr-3 text-right font-medium">Images</th>
          <th className="py-2 pr-3 text-right font-medium">Time</th>
          <th className="py-2 text-right font-medium">Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, b]) => (
          <tr key={name} className="border-b border-rule/60">
            <td className="py-2 pr-3">{name}</td>
            <td className="py-2 pr-3 text-right">
              {b.calls}
              {b.errors > 0 && <span className="text-pencil"> ({b.errors} failed)</span>}
            </td>
            <td className="py-2 pr-3 text-right">
              {b.inputTokens.toLocaleString()} / {b.outputTokens.toLocaleString()}
            </td>
            <td className="py-2 pr-3 text-right">{b.imageCount || ''}</td>
            <td className="py-2 pr-3 text-right">{secs(b.durationMs)}</td>
            <td className="py-2 text-right font-semibold">
              {usd(b.costUsd)}
              {b.unpricedCalls > 0 && <span className="text-amber" title="Some calls used a model without a price entry">*</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CostsPanel({ runId, revision, calls }: { runId: string; revision: number; calls: AiCall[] }) {
  const [report, setReport] = useState<CostReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.costs(runId).then(setReport, (e: Error) => setError(e.message));
  }, [runId, revision, calls.length]);

  if (error) return <p className="text-pencil">{error}</p>;
  if (!report) return <p className="text-ink-soft">Loading costs…</p>;

  const t = report.totals;
  const stageName = (s: string) => STAGE_TITLES[s as Stage] ?? s;
  return (
    <div className="space-y-8">
      <p className="text-ink-soft">
        <span className="font-wide text-4xl font-bold text-ink">{usd(t.costUsd)}</span>
        <span className="ml-3">
          for {t.calls} AI {t.calls === 1 ? 'call' : 'calls'} over {secs(t.durationMs)} of model time
          {t.webSearchCalls > 0 && `, ${t.webSearchCalls} web ${t.webSearchCalls === 1 ? 'search' : 'searches'}`}
        </span>
      </p>
      <div className="overflow-x-auto rounded-md bg-paper px-5 py-3">
        <Rows title="Stage" rows={Object.entries(report.byStage).map(([k, v]) => [stageName(k), v])} />
      </div>
      <div className="overflow-x-auto rounded-md bg-paper px-5 py-3">
        <Rows title="Model" rows={Object.entries(report.byModel)} />
      </div>
      {t.unpricedCalls > 0 && <p className="text-sm text-amber">* {t.unpricedCalls} calls used models without a price entry, so the total is a lower bound.</p>}
    </div>
  );
}
