import { useEffect, useRef, useState } from 'react';
import { api, type PostView, type PostsResponse, type SlideView } from './api.ts';

const FORMAT_LABEL: Record<PostView['format'], string> = { carousel: 'Carousel', single: 'Single image', story: 'Story' };

function scoreTone(qa: SlideView['qa']): string {
  if (!qa) return 'text-ink-faint';
  return qa.passed ? 'text-pass' : 'text-pencil';
}

/** All three posts side by side, the way a client would see them on a phone. */
export function PostsDesk({ runId, revision }: { runId: string; revision: number }) {
  const [data, setData] = useState<PostsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.posts(runId).then(setData, (e: Error) => setError(e.message));
  }, [runId, revision]);

  if (error) return <p className="text-pencil">{error}</p>;
  if (!data) return <p className="text-ink-soft">Loading posts…</p>;

  return (
    <div>
      {!data.reviewed && <p className="mb-6 text-sm text-amber">These are the first drafts. Quality scores appear after the review stage.</p>}
      {data.needsHumanAttention.length > 0 && (
        <div className="mb-8 max-w-[80ch] rounded-md border-l-4 border-pencil bg-paper px-5 py-4">
          <p className="font-semibold">Check these before publishing</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {data.needsHumanAttention.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-10 xl:grid-cols-3">
        {data.posts.map((p) => (
          <PostProof key={p.number} post={p} />
        ))}
      </div>
    </div>
  );
}

function PostProof({ post }: { post: PostView }) {
  const [current, setCurrent] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const slide = post.slides[current];

  const goTo = (i: number) => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  const onScroll = () => {
    const el = track.current;
    if (el) setCurrent(Math.round(el.scrollLeft / el.clientWidth));
  };

  const check = post.captionCheck;

  return (
    <article className="flex flex-col">
      <header className="mb-3">
        <h2 className="font-wide text-xl font-bold">Post {post.number}</h2>
        <p className="text-sm text-ink-soft">
          {FORMAT_LABEL[post.format]}, goal: {post.goal}
        </p>
      </header>

      {/* Phone frame */}
      <div className="mx-auto w-full max-w-[22rem] rounded-[2rem] bg-ink p-2.5 shadow-[0_18px_40px_-20px_rgba(31,42,38,0.6)]">
        <div className="overflow-hidden rounded-[1.5rem] bg-paper">
          <div
            ref={track}
            onScroll={onScroll}
            className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
            aria-label={`Post ${post.number} slides`}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') goTo(Math.min(current + 1, post.slides.length - 1));
              if (e.key === 'ArrowLeft') goTo(Math.max(current - 1, 0));
            }}
          >
            {post.slides.map((s) => (
              <img
                key={s.index}
                src={s.url}
                alt={`Slide ${s.index}: ${s.headline}`}
                className="block w-full shrink-0 snap-center object-cover"
                loading="lazy"
              />
            ))}
          </div>
          {post.slides.length > 1 && (
            <div className="flex justify-center gap-1.5 py-2">
              {post.slides.map((s, i) => (
                <button
                  key={s.index}
                  onClick={() => goTo(i)}
                  aria-label={`Show slide ${s.index}`}
                  aria-current={i === current}
                  className={`h-1.5 rounded-full transition-all ${i === current ? 'w-4 bg-active' : 'w-1.5 bg-rule'}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Proof notes for the visible slide */}
      {slide && (
        <div className="mt-4 rounded-md bg-paper px-4 py-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold">
              Slide {slide.index} of {post.slides.length}
              <span className="font-normal text-ink-soft">, {slide.role}</span>
            </span>
            {slide.qa && (
              <span className={`font-semibold ${scoreTone(slide.qa)}`} title="Vision QA score out of 10">
                {slide.qa.score.toFixed(1)}/10
              </span>
            )}
          </div>
          <p className="mt-1 text-ink-soft">{slide.headline}</p>
          {slide.qa && slide.qa.attempts > 1 && <p className="mt-1 text-xs text-amber">Regenerated once after QA; the better attempt is shown.</p>}
          {slide.qa && slide.qa.issues.length > 0 && (
            <ul className={`mt-2 list-disc pl-5 text-xs ${slide.qa.passed ? 'text-ink-soft' : 'text-pencil'}`}>
              {slide.qa.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Caption */}
      <div className="mt-4 rounded-md bg-paper px-4 py-3">
        <span className="text-sm font-semibold">Caption</span>
        <p className="mt-2 max-h-60 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap">{post.instagramText}</p>
        <button onClick={() => void navigator.clipboard?.writeText(post.instagramText)} className="mt-2 text-xs font-medium text-active underline underline-offset-2">
          Copy for Instagram
        </button>
        {check && (
          <div className={`mt-3 border-t border-rule pt-2 text-xs ${check.passed ? 'text-pass' : 'text-pencil'}`}>
            {check.passed ? 'Every claim matches a verified fact.' : 'The fact check flagged this caption.'}
            {[...check.claims.filter((c) => !c.supported).map((c) => `Unsupported: ${c.text}`), ...check.languageIssues, ...check.codeIssues].map((m) => (
              <p key={m} className="mt-1 text-pencil">
                {m}
              </p>
            ))}
          </div>
        )}
      </div>

      <details className="mt-3 text-sm text-ink-soft">
        <summary className="cursor-pointer font-medium text-ink">Why this post</summary>
        <p className="mt-2">{post.concept}</p>
        <p className="mt-2">{post.rationale}</p>
      </details>
    </article>
  );
}
