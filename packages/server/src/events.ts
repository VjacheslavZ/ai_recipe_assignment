import { EventEmitter } from 'node:events';
import type { AiCallRecord, PendingQuestion, Stage, StageStatus } from '@recipe/core';

export type RunEvent =
  | { type: 'log'; message: string }
  | { type: 'stage'; stage: Stage; status: StageStatus; error?: string }
  | { type: 'ai_call'; call: AiCallRecord }
  | { type: 'question'; question: PendingQuestion }
  | { type: 'question_answered'; id: string }
  | { type: 'run'; status: 'queued' | 'running' | 'succeeded' | 'failed'; error?: string };

/** In-process pub/sub per run; the SSE route subscribes, the worker publishes. */
export class RunEvents {
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  publish(runId: string, event: RunEvent): void {
    this.emitter.emit(runId, event);
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    this.emitter.on(runId, listener);
    return () => this.emitter.off(runId, listener);
  }
}

/**
 * Human-in-the-loop questions from stages (price confirmation, ADR-018). The stage
 * awaits an answer posted through the API; after `timeoutMs` it gets null (= omitted).
 */
export class PendingQuestions {
  private readonly pending = new Map<string, { runId: string; question: PendingQuestion; resolve: (a: string | null) => void }>();

  constructor(
    private readonly events: RunEvents,
    private readonly timeoutMs = 10 * 60_000,
  ) {}

  ask(runId: string, question: PendingQuestion): Promise<string | null> {
    const key = `${runId}:${question.id}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(key, null), this.timeoutMs);
      this.pending.set(key, {
        runId,
        question,
        resolve: (a) => {
          clearTimeout(timer);
          resolve(a);
        },
      });
      this.events.publish(runId, { type: 'question', question });
    });
  }

  answer(runId: string, id: string, answer: string | null): boolean {
    return this.settle(`${runId}:${id}`, answer?.trim() ? answer.trim() : null);
  }

  list(runId: string): PendingQuestion[] {
    return [...this.pending.values()].filter((p) => p.runId === runId).map((p) => p.question);
  }

  private settle(key: string, answer: string | null): boolean {
    const p = this.pending.get(key);
    if (!p) return false;
    this.pending.delete(key);
    p.resolve(answer);
    this.events.publish(p.runId, { type: 'question_answered', id: p.question.id });
    return true;
  }
}
