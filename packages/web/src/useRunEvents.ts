import { useEffect, useReducer } from 'react';
import { STAGES, type AiCall, type Question, type RunEvent, type RunStatus, type Stage, type StageState } from './api.ts';

export interface LiveRun {
  connected: boolean;
  status: RunStatus | null;
  error: string | null;
  stages: Record<Stage, StageState>;
  questions: Question[];
  log: string[];
  calls: AiCall[];
  /** Bumps whenever stage output may have changed, so views refetch posts/artifacts. */
  revision: number;
}

const emptyStages = () => Object.fromEntries(STAGES.map((s) => [s, { status: 'pending' }])) as Record<Stage, StageState>;

const initial: LiveRun = { connected: false, status: null, error: null, stages: emptyStages(), questions: [], log: [], calls: [], revision: 0 };

type Action = RunEvent | { type: 'connected'; value: boolean } | { type: 'reset' };

function reducer(state: LiveRun, e: Action): LiveRun {
  switch (e.type) {
    case 'reset':
      return initial;
    case 'connected':
      return { ...state, connected: e.value };
    case 'snapshot':
      return { ...state, status: e.status, error: e.error, stages: e.state.stages, questions: e.questions, revision: state.revision + 1 };
    case 'log':
      return { ...state, log: [...state.log.slice(-499), e.message] };
    case 'stage': {
      // A new status replaces the old error: a stage that failed and then passed on a re-run shows no error.
      const { error: _previous, ...stage } = state.stages[e.stage];
      return {
        ...state,
        stages: { ...state.stages, [e.stage]: { ...stage, status: e.status, ...(e.error ? { error: e.error } : {}) } },
        revision: e.status === 'done' ? state.revision + 1 : state.revision,
      };
    }
    case 'ai_call':
      return { ...state, calls: [...state.calls, e.call] };
    case 'question':
      return { ...state, questions: [...state.questions.filter((q) => q.id !== e.question.id), e.question] };
    case 'question_answered':
      return { ...state, questions: state.questions.filter((q) => q.id !== e.id) };
    case 'run':
      return { ...state, status: e.status, error: e.error ?? null, revision: state.revision + 1 };
  }
}

/** Subscribes to the run's SSE stream; the server sends a snapshot first, then live events. */
export function useRunEvents(runId: string): LiveRun {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    dispatch({ type: 'reset' });
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const types: RunEvent['type'][] = ['snapshot', 'log', 'stage', 'ai_call', 'question', 'question_answered', 'run'];

    const reconnect = (attempt: number) => {
      source?.close();
      dispatch({ type: 'connected', value: false });
      if (!closed) retry = setTimeout(() => connect(attempt + 1), Math.min(10_000, 1000 * 2 ** attempt));
    };

    const connect = (attempt: number) => {
      source = new EventSource(`/api/runs/${runId}/events`);
      // The server pings every 15 s; silence for longer means the connection is dead even if
      // the browser has not noticed (e.g. a proxy kept it open after the server went away).
      const alive = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => reconnect(attempt), 40_000);
      };
      for (const t of types) {
        source.addEventListener(t, (msg) => {
          alive();
          dispatch(JSON.parse((msg as MessageEvent<string>).data) as RunEvent);
        });
      }
      source.addEventListener('ping', alive);
      source.onopen = () => {
        attempt = 0;
        alive();
        dispatch({ type: 'connected', value: true });
      };
      source.onerror = () => {
        dispatch({ type: 'connected', value: false });
        // The browser retries dropped connections itself, but gives up for good after an HTTP
        // error (e.g. 502 from the dev proxy while the server restarts). Reconnect in that case;
        // the server sends a fresh snapshot on every connection.
        if (source?.readyState === EventSource.CLOSED) reconnect(attempt);
      };
    };
    connect(0);

    return () => {
      closed = true;
      clearTimeout(retry);
      clearTimeout(watchdog);
      source?.close();
    };
  }, [runId]);

  return state;
}
