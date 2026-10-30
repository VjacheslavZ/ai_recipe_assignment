import { STAGES, STAGE_TITLES, type Stage, type StageState } from './api.ts';

const TONE: Record<StageState['status'], { bar: string; text: string; label: string }> = {
  pending: { bar: 'bg-rule', text: 'text-ink-faint', label: 'Not run' },
  running: { bar: 'bg-active animate-pulse', text: 'text-active', label: 'Running' },
  done: { bar: 'bg-pass', text: 'text-pass', label: 'Done' },
  failed: { bar: 'bg-pencil', text: 'text-pencil', label: 'Failed' },
};

function duration(s: StageState): string | null {
  if (!s.startedAt || !s.finishedAt) return null;
  const sec = Math.round((Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 1000);
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

/** The five recipe stages in order; each finished stage can be re-run from that point on. */
export function StageStrip(props: { stages: Record<Stage, StageState>; active: boolean; onRerun: (fromStep: number) => void }) {
  return (
    <ol className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-rule sm:grid-cols-5">
      {STAGES.map((stage, i) => {
        const s = props.stages[stage];
        const tone = TONE[s.status];
        const took = duration(s);
        const canRerun = !props.active && (s.status !== 'pending' || i === 0 || props.stages[STAGES[i - 1]!].status === 'done');
        return (
          <li key={stage} className="flex flex-col bg-paper px-4 pt-3 pb-3">
            <span className={`mb-3 block h-1 rounded-full ${tone.bar}`} />
            <span className="flex items-baseline gap-2">
              <span className="font-narrow text-2xl leading-none font-bold text-ink-faint">{i + 1}</span>
              <span className="text-sm font-semibold">{STAGE_TITLES[stage]}</span>
            </span>
            <span className={`mt-1 text-xs ${tone.text}`}>
              {tone.label}
              {took && <span className="text-ink-faint"> in {took}</span>}
            </span>
            {s.error && <span className="mt-1 line-clamp-3 text-xs text-pencil" title={s.error}>{s.error}</span>}
            {canRerun && (
              <button
                onClick={() => props.onRerun(i + 1)}
                className="mt-auto self-start pt-2 text-xs font-medium text-active underline underline-offset-2"
                title={`Run stages ${i + 1}–5 again; earlier stages keep their output`}
              >
                {s.status === 'pending' ? 'Run from here' : 'Re-run from here'}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
