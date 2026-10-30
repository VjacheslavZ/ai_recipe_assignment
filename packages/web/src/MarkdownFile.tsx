import { marked } from 'marked';
import { useEffect, useState } from 'react';
import { api } from './api.ts';

/** Renders a markdown artifact from the run folder; relative image links resolve against the file's directory. */
export function MarkdownFile({ runId, rel, revision }: { runId: string; rel: string; revision: number }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const base = `/api/runs/${runId}/files/${rel.slice(0, rel.lastIndexOf('/') + 1)}`;
    api
      .file(runId, rel)
      .then(async (md) => {
        const out = await marked.parse(md, {
          walkTokens: (t) => {
            if ((t.type === 'image' || t.type === 'link') && !/^(https?:|\/|#|mailto:)/.test(t.href)) t.href = base + t.href;
          },
        });
        if (!cancelled) setHtml(out);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [runId, rel, revision]);

  if (error) return <p className="text-pencil">Could not load {rel}: {error}</p>;
  if (html === null) return <p className="text-ink-soft">Loading…</p>;
  // The markdown is produced by this app's own pipeline from the run folder, not by end users.
  return <article className="prose-run rounded-md bg-paper px-6 py-6 md:px-10" dangerouslySetInnerHTML={{ __html: html }} />;
}
