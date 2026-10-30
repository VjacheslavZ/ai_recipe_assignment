import { useState, type FormEvent } from 'react';
import { api, type Question } from './api.ts';

/** A question the pipeline is blocked on (e.g. a product price it could not verify). */
export function QuestionCard({ runId, question }: { runId: string; question: Question }) {
  const [answer, setAnswer] = useState(question.suggestedAnswer ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.answer(runId, question.id, value);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(answer.trim() || null);
  };

  return (
    <form onSubmit={submit} className="mt-6 rounded-md border-l-4 border-pencil bg-paper px-5 py-4 shadow-[0_1px_0_var(--color-rule)]">
      <p className="font-semibold">{question.question}</p>
      {question.context && <p className="mt-1 max-w-[72ch] text-sm whitespace-pre-wrap text-ink-soft">{question.context}</p>}
      <p className="mt-1 text-xs text-ink-faint">The run waits up to 10 minutes, then continues without an answer.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          aria-label="Your answer"
          className="min-w-0 flex-1 rounded-md border border-rule bg-white px-3 py-2 text-sm"
        />
        <button type="submit" disabled={busy} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper disabled:opacity-40">
          Send answer
        </button>
        <button type="button" disabled={busy} onClick={() => void send(null)} className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft hover:bg-desk">
          Skip
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-pencil">{error}</p>}
    </form>
  );
}
