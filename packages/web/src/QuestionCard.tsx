import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Question } from './api.ts';

function useSecondsLeft(expiresAt: string): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** A question the pipeline is blocked on (e.g. a product price it could not verify). */
export function QuestionCard({ runId, question, autoFocus }: { runId: string; question: Question; autoFocus: boolean }) {
  const [answer, setAnswer] = useState(question.suggestedAnswer ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const left = useSecondsLeft(question.expiresAt);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

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

  const isPrice = question.id.startsWith('price:');

  return (
    <form onSubmit={submit} className="rounded-md bg-paper px-5 py-4 shadow-[0_1px_0_var(--color-rule)]">
      <label htmlFor={`q-${question.id}`} className="block font-semibold">
        {question.question}
      </label>
      {question.context && <p className="mt-1 max-w-[72ch] text-sm whitespace-pre-wrap text-ink-soft">{question.context}</p>}
      {isPrice && (
        <p className="mt-1 max-w-[72ch] text-sm text-ink-soft">
          The price could not be verified on the brand site. Enter the current price to show it on the post, or leave it out.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          ref={input}
          id={`q-${question.id}`}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          inputMode={isPrice ? 'decimal' : undefined}
          placeholder={isPrice ? 'e.g. 29.90' : undefined}
          className="min-w-0 flex-1 rounded-md border border-ink-faint bg-white px-3 py-2 text-sm"
        />
        <button type="submit" disabled={busy || !answer.trim()} className="rounded-md bg-pencil px-4 py-2 text-sm font-semibold text-paper disabled:opacity-40">
          {isPrice ? 'Use this price' : 'Send answer'}
        </button>
        <button type="button" disabled={busy} onClick={() => void send(null)} className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft hover:bg-desk">
          {isPrice ? 'Leave the price out' : 'Skip'}
        </button>
      </div>
      <p className={`mt-2 text-xs ${left < 120 ? 'font-semibold text-pencil' : 'text-ink-faint'}`}>
        {left > 0
          ? `Without an answer the run continues in ${clock(left)}${isPrice ? ' and the price is left out' : ''}.`
          : 'Time is up; the run is continuing without an answer.'}
      </p>
      {error && <p className="mt-2 text-sm text-pencil">{error}</p>}
    </form>
  );
}
