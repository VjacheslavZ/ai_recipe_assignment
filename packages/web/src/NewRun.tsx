import { useState, type FormEvent } from 'react';
import { api } from './api.ts';

function FilePicker(props: { name: string; label: string; hint: string; multiple?: boolean; files: File[]; onChange: (f: File[]) => void }) {
  return (
    <label className="block rounded-md border border-dashed border-ink-faint/60 bg-paper/60 px-4 py-3 hover:border-ink-soft">
      <span className="block text-sm font-semibold">{props.label}</span>
      <span className="block text-xs text-ink-soft">{props.hint}</span>
      <input
        type="file"
        name={props.name}
        accept="image/png,image/jpeg,image/webp"
        multiple={props.multiple}
        className="mt-2 block w-full text-xs file:mr-3 file:rounded file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-paper"
        onChange={(e) => props.onChange([...(e.target.files ?? [])])}
      />
      {props.files.length > 0 && <span className="mt-1 block text-xs text-ink-soft">{props.files.map((f) => f.name).join(', ')}</span>}
    </label>
  );
}

export function NewRun({ onCreated }: { onCreated: (runId: string) => void }) {
  const [brief, setBrief] = useState('');
  const [logo, setLogo] = useState<File[]>([]);
  const [products, setProducts] = useState<File[]>([]);
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadExample = async () => {
    setError(null);
    try {
      setBrief(await api.exampleBrief());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('brief', brief);
    for (const f of logo) form.append('logo', f);
    for (const f of products) form.append('products', f);
    for (const f of screenshots) form.append('screenshots', f);
    try {
      const { runId } = await api.createRun(form);
      onCreated(runId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-5xl">
      <h1 className="font-wide text-3xl font-bold tracking-tight">Start a run</h1>
      <p className="mt-2 max-w-[62ch] text-ink-soft">
        The recipe reads the brief, researches the brand, plans three posts, builds them from real product photos and checks each slide before
        you see it.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="brief-label">
          <div className="flex items-baseline justify-between">
            <label id="brief-label" htmlFor="brief" className="text-sm font-semibold">
              Brief (YAML)
            </label>
            <button type="button" onClick={loadExample} className="text-sm font-medium text-active underline underline-offset-2">
              Load the GymBeam example
            </button>
          </div>
          <textarea
            id="brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            spellCheck={false}
            placeholder="brand:&#10;  name: …&#10;  slug: …"
            className="mt-2 h-[28rem] w-full resize-y rounded-md border border-rule bg-paper p-4 font-mono text-[13px] leading-relaxed"
          />
        </section>

        <section aria-labelledby="kit-label" className="space-y-3">
          <h2 id="kit-label" className="text-sm font-semibold">
            Brand kit for this run
          </h2>
          <p className="text-xs text-ink-soft">Optional. Anything you leave out comes from the repository’s brand_kit folder.</p>
          <FilePicker name="logo" label="Logo" hint="PNG, transparent background works best" files={logo} onChange={setLogo} />
          <FilePicker
            name="products"
            label="Product photos"
            hint="File names must match imageFile in the brief"
            multiple
            files={products}
            onChange={setProducts}
          />
          <FilePicker name="screenshots" label="Instagram screenshots" hint="6–10 recent posts, used for the style analysis" multiple files={screenshots} onChange={setScreenshots} />
        </section>
      </div>

      {error && (
        <p role="alert" className="mt-6 max-w-[72ch] whitespace-pre-wrap rounded-md border-l-4 border-pencil bg-paper px-4 py-3 text-sm text-pencil">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !brief.trim()}
        className="mt-8 rounded-md bg-ink px-6 py-3 font-semibold text-paper disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? 'Starting…' : 'Start run'}
      </button>
    </form>
  );
}
