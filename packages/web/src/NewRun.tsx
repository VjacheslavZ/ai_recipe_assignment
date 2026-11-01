import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type BriefDraft, type KitFiles, type KitItem, type OpenAiCheck } from './api.ts';

type KitField = 'logo' | 'products' | 'screenshots';

const checker = 'bg-[repeating-conic-gradient(#e5e5e5_0_25%,#fff_0_50%)] bg-[length:12px_12px]';

/** One input file as a small preview, with what it is used for and a way to remove it. */
function Tile({ src, name, note, warn, onRemove }: { src: string; name: string; note: string; warn?: boolean; onRemove: () => void }) {
  return (
    <li className="relative w-[4.75rem]">
      <img src={src} alt={name} title={name} className={`h-[4.75rem] w-[4.75rem] rounded border border-rule object-contain ${checker}`} />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-xs leading-none text-paper hover:bg-pencil"
      >
        ×
      </button>
      <span className={`mt-1 block truncate text-[10px] leading-tight ${warn ? 'text-pencil' : 'text-ink-soft'}`} title={note}>
        {note}
      </span>
    </li>
  );
}

/** A group of input files (logo, products, screenshots) with its upload button. */
function FileGroup(props: {
  field: KitField;
  label: string;
  use: string;
  multiple?: boolean;
  busy: boolean;
  children: ReactNode;
  empty: string;
  count: number;
  onAdd: (field: KitField, files: File[]) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {props.label}
          {props.count > 1 && <span className="ml-1 font-normal text-ink-soft">({props.count})</span>}
        </h3>
        <label className={`shrink-0 cursor-pointer text-xs font-medium text-active underline underline-offset-2 ${props.busy ? 'pointer-events-none opacity-40' : ''}`}>
          {props.count && !props.multiple ? 'Replace' : 'Add'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple={props.multiple}
            className="sr-only"
            onChange={(e) => {
              props.onAdd(props.field, [...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      <p className="text-xs text-ink-soft">{props.use}</p>
      {props.count ? <ul className="mt-2 flex flex-wrap gap-2.5">{props.children}</ul> : <p className="mt-2 rounded border border-dashed border-ink-faint/60 px-3 py-2 text-xs text-ink-faint">{props.empty}</p>}
    </div>
  );
}

/** Free check of the key and model ids before spending money on a real run. */
function OpenAiSetup() {
  const [keySet, setKeySet] = useState<boolean | null>(null);
  const [check, setCheck] = useState<OpenAiCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .health()
      .then((h) => setKeySet(h.provider === 'openai' ? h.openaiKeySet : null))
      .catch(() => setKeySet(null));
  }, []);

  if (keySet === null) return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setCheck(await api.checkOpenAi());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="openai-label" className="rounded-md bg-paper px-4 py-3 shadow-[0_1px_0_var(--color-rule)]">
      <h2 id="openai-label" className="text-sm font-semibold">
        OpenAI setup
      </h2>
      {!keySet ? (
        <p className="mt-1 text-xs text-pencil">OPENAI_API_KEY is not set. Add it to .env, then run docker compose restart server.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-soft">Checks the key and the configured models. Free: no tokens are used.</p>
          <button type="button" disabled={busy} onClick={() => void run()} className="mt-2 text-sm font-medium text-active underline underline-offset-2 disabled:opacity-40">
            {busy ? 'Checking…' : 'Check OpenAI setup'}
          </button>
        </>
      )}
      {error && <p className="mt-2 text-xs text-pencil">{error}</p>}
      {check?.error && <p className="mt-2 text-xs text-pencil">{check.error}</p>}
      {check && check.models.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {check.models.map((m) => (
            <li key={m.role} className={m.available ? 'text-ink-soft' : 'text-pencil'}>
              {m.available ? '✓' : '✗'} {m.role}: <span className="font-mono">{m.model}</span>
              {m.error && ` — ${m.error}`}
              {m.available && !m.priced && ' — no price entry, cost will show as unknown'}
              {m.shutdownDate && ` — shuts down ${m.shutdownDate}`}
            </li>
          ))}
        </ul>
      )}
      {check?.ok && <p className="mt-2 text-xs font-semibold text-ink">Ready for a real run.</p>}
    </section>
  );
}

const DESCRIBE_HINT = `For example: Three posts for GymBeam Croatia (@gymbeamhr), website gymbeam.hr. Products: Protein Fusion and 32% Protein Wafer. Audience: people in Croatia who train regularly. Goals: one educational post, one that gets comments, one that sells. No discounts.`;

const FIELD_LABEL: Record<string, string> = { whyThisBrand: 'Why this brand', audience: 'Audience', goals: 'Goals' };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
      <dt className="text-xs font-semibold text-ink-soft">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function Thumb({ src, label }: { src: string; label: string }) {
  return <img src={src} alt={label} className={`h-14 w-14 shrink-0 rounded border border-rule object-contain ${checker}`} />;
}

const KIT_STATUS: Record<KitItem['status'], string> = { collected: 'Taken from the website', kept: 'Already among your files', not_found: 'Not found' };

interface KitProps {
  collecting: boolean;
  /** URL of an input file of this page (reloads after uploads and collections). */
  url: (rel: string) => string;
  results: KitItem[] | null;
  onCollect: () => void;
}

/** What the recipe understood from the description, for the person to check before starting. */
function BriefCard({ draft, stale, kitProps }: { draft: BriefDraft; stale: boolean; kitProps: KitProps }) {
  const b = draft.brief;
  const kit = draft.kit;
  const photoOf = (name: string) => kit?.products.find((p) => p.name === name);
  const kitIncomplete = kit !== null && b !== null && (!kit.logo || kit.products.some((p) => !p.exists) || b.products.some((p) => !p.url));
  const blocked = draft.missing.length > 0 || draft.issues.length > 0;
  return (
    <section aria-labelledby="draft-title" className={`mt-6 rounded-md bg-paper px-5 py-4 shadow-[0_1px_0_var(--color-rule)] ${stale ? 'opacity-60' : ''}`}>
      <h2 id="draft-title" className="font-semibold">
        {blocked ? 'The brief is not complete yet' : 'Check the brief'}
      </h2>
      {stale && <p className="mt-1 text-sm text-pencil">The description changed. Prepare the brief again before starting.</p>}

      {draft.missing.length > 0 && (
        <div className="mt-3 rounded-md border-l-4 border-pencil bg-pencil/5 px-4 py-2 text-sm">
          <p className="font-semibold text-pencil">Add to the description:</p>
          <ul className="mt-1 list-disc pl-5">
            {draft.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {draft.issues.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-sm text-pencil">
          {draft.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}

      {b && (
        <dl className="mt-4 space-y-2">
          <Field label="Brand">{b.brand.name}</Field>
          <Field label="Instagram">
            <a href={b.brand.instagramUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {b.brand.instagramHandle}
            </a>
          </Field>
          <Field label="Website">
            {[b.brand.website, ...b.brand.shopUrls].join(', ')}
            <span className="block text-xs text-ink-soft">Facts and prices are taken only from these sites.</span>
          </Field>
          <Field label="Logo">
            {kit?.logo ? (
              <Thumb src={kitProps.url(kit.logo)} label={`${b.brand.name} logo`} />
            ) : (
              <span className="text-pencil">Missing: slides will have no logo</span>
            )}
          </Field>
          <Field label="Products">
            <ul className="space-y-2">
              {b.products.map((p) => {
                const photo = photoOf(p.name);
                return (
                  <li key={p.name} className="flex items-start gap-3">
                    {photo?.exists && photo.imageFile ? (
                      <Thumb src={kitProps.url(`products/${photo.imageFile}`)} label={p.name} />
                    ) : (
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-dashed border-pencil text-center text-[10px] leading-tight text-pencil">
                        no photo
                      </span>
                    )}
                    <span>
                      {p.name}
                      <span className="block text-xs break-all text-ink-soft">{p.url ?? 'page will be found on the website'}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Field>
          <Field label="Instagram screenshots">
            {kit?.instagramScreenshots.length ? (
              `${kit.instagramScreenshots.length} for the style analysis`
            ) : (
              <span className="text-ink-soft">None: the style analysis uses the website only. Add 6–10 screenshots to improve it.</span>
            )}
          </Field>
          {kitIncomplete && (
            <div className="rounded-md bg-desk px-4 py-3">
              <button
                type="button"
                onClick={kitProps.onCollect}
                disabled={kitProps.collecting || stale}
                className="rounded-md border border-ink px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              >
                {kitProps.collecting ? 'Looking on the website…' : `Find the logo and product photos on ${new URL(b.brand.website).hostname}`}
              </button>
              <p className="mt-1 text-xs text-ink-soft">
                Downloads the real files from the brand's site and checks each with a vision model (about $0.01). Nothing is generated. Photos you
                already have are checked and kept if they show the right product.
              </p>
            </div>
          )}
          {kitProps.results && (
            <ul className="space-y-1 text-xs">
              {kitProps.results.map((r) => (
                <li key={`${r.kind}-${r.product ?? ''}`} className={r.status === 'not_found' ? 'text-pencil' : 'text-ink-soft'}>
                  <span className="font-medium">{r.kind === 'logo' ? 'Logo' : r.product}</span>: {KIT_STATUS[r.status]}
                  {r.status !== 'kept' && ` — ${r.note}`}
                  {r.sourceUrl && (
                    <>
                      {' '}
                      (
                      <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                        source
                      </a>
                      )
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Field label="Audience">{b.audience}</Field>
          <Field label="Goals">
            <ul className="list-disc pl-4">
              {b.goals.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </Field>
          <Field label="Why this brand">{b.brand.whyThisBrand}</Field>
          {b.notes && <Field label="Notes">{b.notes}</Field>}
          <Field label="Rules">
            <details>
              <summary className="cursor-pointer text-ink-soft">{b.constraints.length} rules, including the standard ones</summary>
              <ul className="mt-1 list-disc pl-4">
                {b.constraints.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </details>
          </Field>
        </dl>
      )}

      {draft.assumptions.length > 0 && (
        <div className="mt-4 text-sm">
          <p className="font-semibold">Proposed by the AI, not in your description</p>
          <ul className="mt-1 list-disc pl-5 text-ink-soft">
            {draft.assumptions.map((a) => (
              <li key={a.field}>
                <span className="font-medium text-ink">{FIELD_LABEL[a.field] ?? a.field}</span>: {a.value}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink-faint">If any of this is wrong, say it in the description and prepare the brief again.</p>
        </div>
      )}
      {draft.warnings.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-xs text-ink-soft">
          {draft.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function NewRun({ onCreated }: { onCreated: (runId: string) => void }) {
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<BriefDraft | null>(null);
  const [draftedFrom, setDraftedFrom] = useState('');
  const [yaml, setYaml] = useState('');
  const [showYaml, setShowYaml] = useState(false);
  // This page's input files (ADR-033): uploaded right away, previewed, moved into the run on start.
  const [kitId, setKitId] = useState<string | null>(null);
  const [files, setFiles] = useState<KitFiles>({ logo: null, products: [], instagram: [] });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [kitVersion, setKitVersion] = useState(0);
  const [kitResults, setKitResults] = useState<KitItem[] | null>(null);

  useEffect(() => {
    api
      .createKit()
      .then(({ kitId: id, files: f }) => {
        setKitId(id);
        setFiles(f);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const changeFiles = async (change: () => Promise<KitFiles>) => {
    setUploading(true);
    setError(null);
    try {
      setFiles(await change());
      setKitVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const addFiles = (field: KitField, picked: File[]) => kitId && picked.length && void changeFiles(() => api.uploadKitFiles(kitId, field, picked));
  const removeFile = (rel: string) => kitId && void changeFiles(() => api.removeKitFile(kitId, rel));
  const fileUrl = (rel: string) => (kitId ? api.kitFileUrl(kitId, rel, kitVersion) : '');

  // Product photos take part in the brief (matched to products), so new uploads also need a new draft.
  const draftKey = `${text.trim()}\n${files.products.join('\n')}`;
  const stale = draft !== null && draftKey !== draftedFrom;
  const yamlEdited = draft !== null && yaml !== draft.yaml;
  const ready = draft !== null && !stale && (yamlEdited || (draft.missing.length === 0 && draft.issues.length === 0));

  const loadExample = async () => {
    setError(null);
    try {
      setText(await api.exampleRequest());
      if (kitId) await changeFiles(() => api.loadKitExample(kitId));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const prepare = async () => {
    setPreparing(true);
    setError(null);
    try {
      const d = await api.draftBrief(text, kitId ?? '');
      setDraft(d);
      setYaml(d.yaml);
      setKitResults(null);
      setDraftedFrom(draftKey);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  };

  const collect = async () => {
    if (!draft || !kitId) return;
    setCollecting(true);
    setError(null);
    try {
      const c = await api.collectKit(yaml, draft.draftId, kitId);
      // The brief now names the found pages and photo files; it counts as prepared, not edited.
      setDraft({ ...draft, yaml: c.yaml, brief: c.brief, warnings: c.warnings, kit: c.kit });
      setYaml(c.yaml);
      setKitResults(c.items);
      setFiles(c.files);
      setKitVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCollecting(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !kitId) return;
    setBusy(true);
    setError(null);
    try {
      const { runId } = await api.createRun(yaml, draft.draftId, kitId);
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
        <div>
          <section aria-labelledby="describe-label">
            <div className="flex items-baseline justify-between gap-4">
              <label id="describe-label" htmlFor="describe" className="text-sm font-semibold">
                Describe the brand and the posts you want
              </label>
              <button type="button" onClick={loadExample} className="shrink-0 text-sm font-medium text-active underline underline-offset-2">
                Load the GymBeam example
              </button>
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              Name the brand, its Instagram account and website, the products to promote, who the posts are for, what they should achieve, and any
              references or inspiration (links). Write it any way you like.
            </p>
            <textarea
              id="describe"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={DESCRIBE_HINT}
              className="mt-2 h-64 w-full resize-y rounded-md border border-rule bg-paper p-4 text-sm leading-relaxed"
            />
            <button
              type="button"
              onClick={() => void prepare()}
              disabled={preparing || !text.trim()}
              className="mt-3 rounded-md border border-ink px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            >
              {preparing ? 'Reading the description…' : draft ? 'Prepare the brief again' : 'Prepare brief'}
            </button>
          </section>

          {draft && <BriefCard draft={draft} stale={stale} kitProps={{ collecting, url: fileUrl, results: kitResults, onCollect: () => void collect() }} />}

          {draft && (
            <div className="mt-3">
              <button type="button" onClick={() => setShowYaml((v) => !v)} className="text-sm font-medium text-ink-soft underline underline-offset-2">
                {showYaml ? 'Hide the brief as YAML' : 'Edit the brief as YAML'}
              </button>
              {showYaml && (
                <>
                  <textarea
                    aria-label="Brief as YAML"
                    value={yaml}
                    onChange={(e) => setYaml(e.target.value)}
                    spellCheck={false}
                    className="mt-2 h-80 w-full resize-y rounded-md border border-rule bg-paper p-4 font-mono text-[13px] leading-relaxed"
                  />
                  {yamlEdited && <p className="text-xs text-ink-soft">The run starts from the edited YAML; the card above shows the prepared version.</p>}
                </>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <OpenAiSetup />
          <section aria-labelledby="kit-label" className="space-y-5 rounded-md bg-paper px-4 py-4 shadow-[0_1px_0_var(--color-rule)]">
            <div>
              <h2 id="kit-label" className="text-sm font-semibold">
                Files for this run
              </h2>
              <p className="mt-1 text-xs text-ink-soft">Uploaded for this run only. The run keeps its own copy; nothing is shared between runs.</p>
            </div>
            <FileGroup field="logo" label="Logo" use="Placed on every slide, never redrawn." busy={uploading || !kitId} count={files.logo ? 1 : 0} empty="No logo: slides will have none." onAdd={addFiles}>
              {files.logo && <Tile src={fileUrl(files.logo)} name="logo.png" note="every slide" onRemove={() => removeFile(files.logo!)} />}
            </FileGroup>
            <FileGroup
              field="products"
              label="Product photos"
              use="Composited as they are. Matched to products when the brief is prepared."
              multiple
              busy={uploading || !kitId}
              count={files.products.length}
              empty="No photos yet. Upload them or find them on the brand's website after preparing the brief."
              onAdd={addFiles}
            >
              {files.products.map((rel) => {
                const name = rel.slice('products/'.length);
                const product = draft?.brief?.products.find((p) => p.imageFile === name);
                return (
                  <Tile
                    key={rel}
                    src={fileUrl(rel)}
                    name={name}
                    note={product ? product.name : draft?.brief ? 'not used in the brief' : name}
                    warn={Boolean(draft?.brief) && !product}
                    onRemove={() => removeFile(rel)}
                  />
                );
              })}
            </FileGroup>
            <FileGroup
              field="screenshots"
              label="Instagram screenshots"
              use="6–10 recent posts; a vision model reads the brand's style from them."
              multiple
              busy={uploading || !kitId}
              count={files.instagram.length}
              empty="None: the style comes from the website only."
              onAdd={addFiles}
            >
              {files.instagram.map((rel) => (
                <Tile key={rel} src={fileUrl(rel)} name={rel.slice('instagram/'.length)} note="style" onRemove={() => removeFile(rel)} />
              ))}
            </FileGroup>
          </section>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-6 max-w-[72ch] whitespace-pre-wrap rounded-md border-l-4 border-pencil bg-paper px-4 py-3 text-sm text-pencil">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !ready}
        className="mt-8 rounded-md bg-ink px-6 py-3 font-semibold text-paper disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? 'Starting…' : 'Start run'}
      </button>
    </form>
  );
}
