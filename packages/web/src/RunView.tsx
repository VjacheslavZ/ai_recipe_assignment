import { useEffect, useRef, useState } from 'react';
import { api, STAGES, type RunDetail, type Stage } from './api.ts';
import { formatTime } from './App.tsx';
import { CostsPanel } from './CostsPanel.tsx';
import { MarkdownFile } from './MarkdownFile.tsx';
import { PostsDesk } from './PostsDesk.tsx';
import { QuestionCard } from './QuestionCard.tsx';
import { StageStrip } from './StageStrip.tsx';
import { useRunEvents } from './useRunEvents.ts';

const TABS = ['Posts', 'Analysis', 'Plan', 'Review', 'Costs', 'Log'] as const;
type Tab = (typeof TABS)[number];

const TAB_STAGE: Partial<Record<Tab, Stage>> = { Posts: 'create', Analysis: 'analysis', Plan: 'plan', Review: 'review' };

const stageFile = (stage: Stage, file: string) => `${String(STAGES.indexOf(stage) + 1).padStart(2, '0')}_${stage}/${file}`;

/** The files the run was made from, as small previews (they live in the run's inputs folder). */
function RunInputs({ inputs }: { inputs: NonNullable<RunDetail['inputs']> }) {
  const groups = [
    { label: 'Logo', files: inputs.logo ? [inputs.logo] : [] },
    { label: 'Product photos', files: inputs.products },
    { label: 'Instagram screenshots', files: inputs.instagram },
  ];
  return (
    <section aria-labelledby="inputs-title" className="mt-6">
      <h2 id="inputs-title" className="text-sm font-semibold">
        Files used by this run
      </h2>
      <div className="mt-2 flex flex-wrap gap-x-8 gap-y-3">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="text-xs text-ink-soft">
              {g.label}
              {g.files.length > 1 && ` (${g.files.length})`}
            </p>
            {g.files.length ? (
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {g.files.map((rel) => (
                  <li key={rel}>
                    <a href={`${inputs.base}/${rel}`} target="_blank" rel="noreferrer" title={rel}>
                      <img
                        src={`${inputs.base}/${rel}`}
                        alt={rel}
                        className="h-12 w-12 rounded border border-rule bg-[repeating-conic-gradient(#e5e5e5_0_25%,#fff_0_50%)] bg-[length:10px_10px] object-contain"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-ink-faint">none</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function RunView({ runId, onChanged }: { runId: string; onChanged: () => void }) {
  const live = useRunEvents(runId);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>('Posts');
  const [rerunError, setRerunError] = useState<string | null>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    api
      .getRun(runId)
      .then(setRun)
      .catch(() => setNotFound(true));
    onChangedRef.current();
  }, [runId, live.revision]);

  if (notFound) return <p className="text-pencil">This run does not exist. Pick another one from the list.</p>;
  if (!run) return <p className="text-ink-soft">Loading run…</p>;

  const status = live.status ?? run.status;
  const active = status === 'queued' || status === 'running';
  // Live events carry status only; timestamps come from the run state refetched on each revision.
  const stages = live.status
    ? (Object.fromEntries(
        STAGES.map((s) => [s, run.state.stages[s]?.status === live.stages[s].status ? { ...run.state.stages[s], ...live.stages[s] } : live.stages[s]]),
      ) as typeof live.stages)
    : run.state.stages;
  const error = live.status ? live.error : run.error;

  const rerun = async (fromStep: number) => {
    setRerunError(null);
    try {
      await api.rerun(runId, fromStep);
    } catch (e) {
      setRerunError((e as Error).message);
    }
  };

  const tabEnabled = (t: Tab) => {
    const stage = TAB_STAGE[t];
    return !stage || stages[stage].status === 'done';
  };

  return (
    <div className="max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-wide text-3xl font-bold tracking-tight">{run.brandSlug}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Run {run.id}, started {formatTime(run.createdAt)}
            {run.provider === 'mock' && <span className="text-amber"> with mock AI</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!live.connected && active && <span className="text-xs text-amber">Reconnecting to live updates…</span>}
          {stages.review.status === 'done' && (
            <a href={api.downloadUrl(runId)} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper">
              Download posts.zip
            </a>
          )}
        </div>
      </header>

      {live.questions.length > 0 && (
        <section aria-labelledby="waiting-title" className="mt-6 rounded-lg border-2 border-pencil bg-pencil/5 p-4 md:p-5">
          <h2 id="waiting-title" className="font-wide text-lg font-bold text-pencil">
            {live.questions.length === 1 ? 'The run is waiting for your answer' : `The run is waiting for ${live.questions.length} answers`}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">Nothing else happens until you answer or the time runs out.</p>
          <div className="mt-4 space-y-3">
            {live.questions.map((q, i) => (
              <QuestionCard key={q.id} runId={runId} question={q} autoFocus={i === 0} />
            ))}
          </div>
        </section>
      )}

      <StageStrip stages={stages} active={active} waiting={live.questions.length > 0} onRerun={rerun} />

      {run.inputs && <RunInputs inputs={run.inputs} />}

      {error && (
        <p role="alert" className="mt-4 whitespace-pre-wrap rounded-md border-l-4 border-pencil bg-paper px-4 py-3 text-sm text-pencil">
          {error}
        </p>
      )}
      {rerunError && <p className="mt-3 text-sm text-pencil">{rerunError}</p>}

      <div role="tablist" aria-label="Run output" className="mt-8 flex gap-1 overflow-x-auto border-b border-rule">
        {TABS.map((t) => {
          const enabled = tabEnabled(t);
          return (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              disabled={!enabled}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:text-ink-faint/60 ${
                tab === t ? 'border-ink text-ink' : 'border-transparent text-ink-soft hover:text-ink'
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>

      <section role="tabpanel" className="pt-6">
        {!tabEnabled(tab) ? (
          <p className="text-ink-soft">{active ? 'This appears when its stage finishes.' : 'This stage has no output yet. Run it from the strip above.'}</p>
        ) : tab === 'Posts' ? (
          <PostsDesk runId={runId} revision={live.revision} />
        ) : tab === 'Analysis' ? (
          <MarkdownFile runId={runId} rel={stageFile('analysis', 'analysis.md')} revision={live.revision} />
        ) : tab === 'Plan' ? (
          <MarkdownFile runId={runId} rel={stageFile('plan', 'plan.md')} revision={live.revision} />
        ) : tab === 'Review' ? (
          <MarkdownFile runId={runId} rel={stageFile('review', 'review.md')} revision={live.revision} />
        ) : tab === 'Costs' ? (
          <CostsPanel runId={runId} revision={live.revision} calls={live.calls} />
        ) : (
          <LogPanel lines={live.log} active={active} />
        )}
      </section>
    </div>
  );
}

function LogPanel({ lines, active }: { lines: string[]; active: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [lines.length]);
  if (lines.length === 0) {
    return <p className="text-ink-soft">{active ? 'Waiting for the first log line…' : 'The log shows lines from runs started while this page is open.'}</p>;
  }
  return (
    <div className="max-h-[60vh] overflow-y-auto rounded-md bg-ink p-4 font-mono text-[12.5px] leading-relaxed text-paper/90">
      {lines.map((l, i) => (
        <div key={i} className="whitespace-pre-wrap">
          {l}
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}
