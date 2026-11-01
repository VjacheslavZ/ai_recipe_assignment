import { bullets, sections, type BuiltPrompt } from './shared.js';

export const KIT_PROMPT_VERSION = 'kit@1';

export interface ProductPageMatchPromptInput {
  brandName: string;
  products: { name: string; notes: string | null; candidates: { url: string; title: string }[] }[];
}

/** Brand-kit collection — pick each product's official page from the site-search results. */
export function buildProductPageMatchPrompt({ brandName, products }: ProductPageMatchPromptInput): BuiltPrompt {
  const system = sections(
    `You match products from a marketing brief to their pages on ${brandName}'s official online shop.`,
    `## Rules
${bullets([
  'For each product, choose the one candidate whose title is this exact product (same product line; any flavour or size is fine unless the notes ask for one).',
  'Return null when no candidate is clearly this product. A similar product of another line or brand is not a match.',
  'The url must be copied exactly from the candidates.',
])}`,
  );
  const input = products
    .map((p) =>
      sections(
        `## Product: ${p.name}${p.notes ? `\nNotes: ${p.notes}` : ''}`,
        p.candidates.length ? bullets(p.candidates.map((c) => `${c.title} — ${c.url}`)) : '(no candidates found)',
      ),
    )
    .join('\n\n');
  return { system, input };
}

export interface ImagePickPromptInput {
  kind: 'logo' | 'product';
  brandName: string;
  productName?: string;
  count: number;
}

/** Brand-kit collection — the vision model checks which candidate image to use, if any. */
export function buildImagePickPrompt({ kind, brandName, productName, count }: ImagePickPromptInput): BuiltPrompt {
  const want =
    kind === 'logo'
      ? `the official logo of ${brandName}: the brand wordmark or logo itself, not a favicon of a single letter if a full logo is among the images, not a banner, photo or product.`
      : `a clean packshot of "${productName}" by ${brandName}: the real packaging, front side, product alone on a plain or transparent background, label readable. Not a lifestyle photo, not a nutrition table, not a different product.`;
  const system = sections(
    `You check images collected from a brand's official website before they are used in Instagram posts. Logos and packaging must be the real ones, so only choose an image that clearly is what is asked for.`,
    `## Task
The ${count} images are numbered 1 to ${count} in the order given. Choose the one that is ${want}
If several fit, choose the sharpest and most complete. If none fits, return null. Explain briefly.`,
  );
  return { system, input: `Choose the image: ${kind === 'logo' ? `logo of ${brandName}` : productName}.` };
}
