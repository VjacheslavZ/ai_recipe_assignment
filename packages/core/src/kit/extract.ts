/**
 * Finds logo, product links and product images in shop HTML. Plain pattern matching over
 * the markup that shops publish for search engines and social previews (JSON-LD, Open Graph),
 * so it works on most platforms without a DOM library.
 */

const ENTITIES: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(amp|quot|#39|lt|gt|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

function absolute(url: string, base: string): string | null {
  try {
    const u = new URL(decodeEntities(url.trim()), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

const unique = (urls: (string | null)[]) => [...new Set(urls.filter((u): u is string => Boolean(u)))];

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? null) : null;
}

function metaContent(html: string, property: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if ((attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase() === property) return attr(tag, 'content');
  }
  return null;
}

/** All JSON-LD objects on the page, flattened (`@graph` and arrays included). */
export function jsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') {
      out.push(v as Record<string, unknown>);
      if ('@graph' in v) visit((v as { '@graph': unknown })['@graph']);
    }
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1]!));
    } catch {
      // Broken JSON-LD is common; skip it.
    }
  }
  return out;
}

const types = (o: Record<string, unknown>) => [o['@type']].flat().map(String);

function imageUrls(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(imageUrls);
  if (v && typeof v === 'object') return imageUrls((v as { url?: unknown; contentUrl?: unknown }).url ?? (v as { contentUrl?: unknown }).contentUrl);
  return [];
}

/** Logo candidates, best first: JSON-LD logo, `<img>` marked as logo, touch icon, large favicon. */
export function findLogoCandidates(html: string, base: string): string[] {
  const ld = jsonLd(html).flatMap((o) => [...imageUrls(o.logo), ...imageUrls((o.publisher as Record<string, unknown> | undefined)?.logo)]);
  const imgs = (html.match(/<img\b[^>]*>/gi) ?? [])
    .filter((t) => /logo/i.test(`${attr(t, 'src') ?? ''} ${attr(t, 'alt') ?? ''} ${attr(t, 'class') ?? ''}`))
    .map((t) => attr(t, 'src') ?? attr(t, 'data-src'));
  const icons = (html.match(/<link\b[^>]*>/gi) ?? [])
    .filter((t) => /apple-touch-icon|icon/i.test(attr(t, 'rel') ?? '') && !/\.ico(\?|$)/i.test(attr(t, 'href') ?? ''))
    .sort((a, b) => Number(/apple-touch/i.test(attr(b, 'rel') ?? '')) - Number(/apple-touch/i.test(attr(a, 'rel') ?? '')))
    .map((t) => attr(t, 'href'));
  return unique([...ld, ...imgs, ...icons].map((u) => (u ? absolute(u, base) : null))).slice(0, 4);
}

/** Product image candidates on a product page: Open Graph / Twitter image, JSON-LD Product images. */
export function findProductImages(html: string, base: string): string[] {
  const ld = jsonLd(html)
    .filter((o) => types(o).includes('Product'))
    .flatMap((o) => imageUrls(o.image));
  const og = [metaContent(html, 'og:image'), metaContent(html, 'og:image:secure_url'), metaContent(html, 'twitter:image')];
  return unique([...og, ...ld].map((u) => (u ? absolute(u, base) : null))).slice(0, 4);
}

export interface LinkCandidate {
  url: string;
  title: string;
}

/**
 * Links on a search results page that are not on the home page (navigation, footer), on the
 * shop's own host: these are the results. Titles are the link text or `title` attribute.
 */
export function findResultLinks(searchHtml: string, homeHtml: string, base: string): LinkCandidate[] {
  const host = new URL(base).hostname.replace(/^www\./, '');
  const links = (html: string) =>
    [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => {
      const href = attr(m[1]!, 'href');
      const url = href ? absolute(href, base) : null;
      const text = decodeEntities((attr(m[1]!, 'title') ?? m[2]!).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      return { url: url?.split('#')[0] ?? null, title: text };
    });
  const onHome = new Set(links(homeHtml).map((l) => l.url));
  const byUrl = new Map<string, string>();
  for (const l of links(searchHtml)) {
    if (!l.url || onHome.has(l.url)) continue;
    const u = new URL(l.url);
    if (u.hostname.replace(/^www\./, '') !== host || u.search || u.pathname === '/' || /search|cart|login|account|wishlist|checkout/i.test(u.pathname)) continue;
    if (l.title.length < 4 || l.title.length > 160) continue;
    // A tile often has several links (image, name, rating); keep the most descriptive text.
    if ((byUrl.get(l.url) ?? '').length < l.title.length) byUrl.set(l.url, l.title);
  }
  return [...byUrl].map(([url, title]) => ({ url, title })).slice(0, 30);
}

/** Search URLs to try, by shop platform: Magento, Shopify, WooCommerce, generic. */
export function searchUrls(website: string, query: string): string[] {
  const q = encodeURIComponent(query);
  const base = website.replace(/\/+$/, '');
  return [`${base}/catalogsearch/result/?q=${q}`, `${base}/search?q=${q}&type=product`, `${base}/?s=${q}&post_type=product`, `${base}/search?q=${q}`];
}
