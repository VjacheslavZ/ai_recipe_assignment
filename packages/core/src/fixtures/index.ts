/**
 * Mock AI fixtures (ADR-019) for GymBeam Croatia, keyed by `purpose`.
 *
 * THESE ARE NOT FACTS. They only have a realistic shape so the pipeline can run
 * without an API key. Every statement/evidence is prefixed "[MOCK]", sources point
 * at the shop homepage only, and the one "verified" price is an obvious placeholder.
 * Product names must match `brief.example.yaml`.
 */
import type { MockFixtures, Source } from '../ai/types.js';
import type { InstagramAnalysisModel, SiteAnalysisModel } from '../schemas/analysis.js';
import type { ContentPlanModel } from '../schemas/plan.js';
import type { CaptionReviewModel, SlideReviewModel } from '../schemas/review.js';

const HOME = 'https://gymbeam.hr/';
const EVIDENCE = '[MOCK] placeholder evidence — a live run replaces this with a quote from the page';

export const WHEY = 'GymBeam True Whey Protein';
export const CREATINE = 'GymBeam Creatine Monohydrate';
export const BAR = 'GymBeam Protein Bar';

export const siteFixture = {
  brandFacts: [
    { statement: '[MOCK] GymBeam runs an online shop for the Croatian market at gymbeam.hr.', status: 'verified', source: HOME, evidence: EVIDENCE },
    { statement: '[MOCK] The shop sells sports nutrition including protein powders, creatine and protein bars.', status: 'verified', source: HOME, evidence: EVIDENCE },
    { statement: '[MOCK] The shop offers its own GymBeam-branded product line alongside other brands.', status: 'verified', source: HOME, evidence: EVIDENCE },
    { statement: '[MOCK] The brand seems to target gym-goers and active people aged roughly 18–40.', status: 'assumption', source: null, evidence: '[MOCK] inferred from product range' },
    { statement: '[MOCK] Delivery terms page could not be opened during research.', status: 'unavailable', source: HOME, evidence: null },
  ],
  products: [
    {
      briefProductName: WHEY,
      pageTitle: '[MOCK] True Whey',
      url: HOME,
      price: {
        amount: 99.99,
        currency: 'EUR',
        priceText: '[MOCK] placeholder price — not the real price',
        sourceUrl: HOME,
        confident: true,
        uncertaintyNote: null,
      },
      claims: [
        { statement: '[MOCK] The product page lists the protein content per serving.', status: 'verified', source: HOME, evidence: EVIDENCE },
        { statement: '[MOCK] The product page lists several flavours.', status: 'verified', source: HOME, evidence: EVIDENCE },
      ],
    },
    {
      briefProductName: CREATINE,
      pageTitle: '[MOCK] Creatine Monohydrate',
      url: HOME,
      price: {
        amount: null,
        currency: null,
        priceText: null,
        sourceUrl: null,
        confident: false,
        uncertaintyNote: '[MOCK] price not found on the product page',
      },
      claims: [
        { statement: '[MOCK] The product page lists creatine monohydrate as the ingredient.', status: 'verified', source: HOME, evidence: EVIDENCE },
        { statement: '[MOCK] The product page shows a recommended daily serving.', status: 'verified', source: HOME, evidence: EVIDENCE },
      ],
    },
    {
      briefProductName: BAR,
      pageTitle: '[MOCK] Protein Bar',
      url: HOME,
      price: {
        amount: 1.99,
        currency: 'EUR',
        priceText: '[MOCK] placeholder — promo and regular price both shown',
        sourceUrl: HOME,
        confident: false,
        uncertaintyNote: '[MOCK] promo vs regular price is ambiguous',
      },
      claims: [],
    },
  ],
  toneSignals: '[MOCK] Direct, motivating, informal second person ("ti").',
  audienceSignals: '[MOCK] Fitness enthusiasts and active people in Croatia.',
  sourcesUnavailable: [{ source: HOME, reason: '[MOCK] delivery terms page timed out' }],
} satisfies SiteAnalysisModel;

export const siteFixtureSources: Source[] = [{ url: HOME, title: '[MOCK] GymBeam Croatia — homepage' }];

export const instagramFixture = {
  tone: '[MOCK] Energetic and motivating, informal "ti" address, short punchy lines.',
  audience: '[MOCK] Young adults who train regularly and follow sports-nutrition content.',
  contentPillars: ['[MOCK] Product spotlights', '[MOCK] Training and nutrition tips', '[MOCK] Promotions and giveaways', '[MOCK] Community questions'],
  visualStyle: {
    colorsHex: ['#111111', '#FFFFFF', '#FF6A00'],
    typography: '[MOCK] Bold condensed uppercase sans-serif headlines, light sans-serif body text.',
    layoutPatterns: ['[MOCK] Product packshot centred on a clean background', '[MOCK] Headline at the top, logo in a corner'],
    photoStyle: '[MOCK] High-contrast studio packshots and gym scenes with dramatic lighting.',
  },
  productPresentation: '[MOCK] Clean cut-out packshots, often with flavour cues around the product.',
  peoplePresentation: '[MOCK] Athletes in action, frequently without faces in focus.',
  captionStyle: {
    length: '[MOCK] Short to medium (2–4 sentences)',
    emojis: '[MOCK] 1–3 emojis per caption',
    hashtags: '[MOCK] 3–6 hashtags incl. #gymbeam',
    ctaPatterns: ['[MOCK] Napiši u komentar…', '[MOCK] Link u opisu profila'],
    language: '[MOCK] Croatian on the account; posts are written in English',
  },
  observations: [
    { statement: '[MOCK] Feed grid alternates product packshots and training photos.', status: 'verified', source: '01.png', evidence: '[MOCK] observation placeholder' },
    { statement: '[MOCK] Headlines are set in bold uppercase.', status: 'verified', source: '02.png', evidence: '[MOCK] observation placeholder' },
  ],
  screenshotsUnreadable: [],
} satisfies InstagramAnalysisModel;

const DARK = '#111111';
const WHITE = '#FFFFFF';
const ACCENT = '#FF6A00';
const NO_PRODUCT =
  'no product, no packaging, no text, no letters, no logos, no faces';

export const planFixture = {
  summary:
    '[MOCK] A three-post set: an educational creatine carousel to earn saves, a single-image flavour question to spark comments, and a short story sequence that nudges purchase of the whey protein.',
  posts: [
    {
      number: 1,
      format: 'carousel',
      goal: 'education',
      concept: '[MOCK] "Creatine without the guesswork": a short swipe guide on reading the label before buying.',
      rationale: '[MOCK] Matches the tips pillar and bold uppercase headline style; relies only on what the product page states (F-P2-01, F-P2-02).',
      slides: [
        { index: 1, role: 'hook', headline: 'Creatine without the guesswork', subtext: 'A short guide before you buy', productName: null, showPrice: false, backgroundPrompt: `Dark gym floor with a chalk-dusted wooden bench, dramatic side lighting, orange rim light, empty space in the centre, ${NO_PRODUCT}`, layout: 'text-only', brandColorsHex: [DARK, ACCENT] },
        { index: 2, role: 'tip', headline: 'What does the label say?', subtext: 'Check the ingredients and the recommended serving', productName: null, showPrice: false, backgroundPrompt: `Close-up of a matte black surface with soft orange gradient light, minimal, empty upper half, ${NO_PRODUCT}`, layout: 'text-only', brandColorsHex: [DARK, WHITE] },
        { index: 3, role: 'product', headline: 'Meet our creatine', subtext: null, productName: CREATINE, showPrice: false, backgroundPrompt: `Studio set with a dark concrete plinth on the right, warm orange backlight, clean empty space for a product, ${NO_PRODUCT}`, layout: 'product-right', brandColorsHex: [DARK, ACCENT] },
        { index: 4, role: 'cta', headline: 'Save it for later', subtext: 'More details at gymbeam.hr', productName: null, showPrice: false, backgroundPrompt: `Blurred gym interior in the evening, bokeh lights in orange tones, anonymous silhouettes far in the background, ${NO_PRODUCT}`, layout: 'text-only', brandColorsHex: [DARK, ACCENT, WHITE] },
      ],
      caption: 'Creatine is one of the most popular supplements – but do you know what the pack actually says? 💪 Swipe through and save this for your next order. Find all product details at gymbeam.hr 👉',
      hashtags: ['#gymbeam', '#creatine', '#fitness', '#gym'],
      cta: 'Save this post for later',
      factIds: ['F-P2-01', 'F-P2-02'],
    },
    {
      number: 2,
      format: 'single',
      goal: 'engagement',
      concept: '[MOCK] A flavour question next to the whey packshot to invite comments.',
      rationale: '[MOCK] Community questions are a recurring pillar; the page lists several flavours (F-P1-02), so the question is grounded.',
      slides: [
        { index: 1, role: 'question', headline: 'Which flavour do you pick after training?', subtext: 'Tell us in the comments 👇', productName: WHEY, showPrice: false, backgroundPrompt: `Bright clean studio with a white plinth in the centre, soft orange accent shadow, generous empty space above, ${NO_PRODUCT}`, layout: 'product-center', brandColorsHex: [WHITE, ACCENT] },
      ],
      caption: 'Chocolate, vanilla or something else entirely? 🍫 Tell us in the comments which protein flavour is your post-workout favourite!',
      hashtags: ['#gymbeam', '#protein', '#whey', '#fitnesscroatia'],
      cta: 'Tell us in the comments',
      factIds: ['F-P1-02'],
    },
    {
      number: 3,
      format: 'story',
      goal: 'purchase_intent',
      concept: '[MOCK] "Workout done?" — a three-frame story ending with the whey protein and a shop link.',
      rationale: '[MOCK] Short, energetic frames mirror the motivating tone; the price is shown only because it is verified (mock) data; F-SITE-01 grounds the shop CTA.',
      slides: [
        { index: 1, role: 'hook', headline: 'Workout done?', subtext: null, productName: null, showPrice: false, backgroundPrompt: `Vertical shot of an empty gym locker room, moody lighting with orange highlights, ${NO_PRODUCT}`, layout: 'text-only', brandColorsHex: [DARK, ACCENT] },
        { index: 2, role: 'product', headline: 'Time for protein', subtext: null, productName: WHEY, showPrice: true, backgroundPrompt: `Vertical studio scene, dark backdrop with an orange glow behind a central pedestal, empty centre for a product, ${NO_PRODUCT}`, layout: 'product-center', brandColorsHex: [DARK, ACCENT, WHITE] },
        { index: 3, role: 'cta', headline: 'Order at gymbeam.hr', subtext: 'Tap the link', productName: null, showPrice: false, backgroundPrompt: `Vertical abstract background of dark diagonal stripes with orange accents, ${NO_PRODUCT}`, layout: 'text-only', brandColorsHex: [DARK, ACCENT] },
      ],
      caption: 'Workout done – time for a shake. Check out our True Whey at gymbeam.hr 🛒',
      hashtags: ['#gymbeam', '#protein'],
      cta: 'Order at gymbeam.hr',
      factIds: ['F-SITE-01'],
    },
  ],
} satisfies ContentPlanModel;

const ok = (reason: string) => ({ score: 5, reason: `[MOCK] ${reason}` });

/** Every slide passes the mock QA; tests override this fixture to exercise regeneration. */
export const slideReviewFixture = {
  brandFit: ok('Palette and mood match the analysis.'),
  readability: ok('White headline on a darkened area, large enough at phone size.'),
  productAccuracy: ok('Product is the composited reference photo.'),
  goalFit: ok('Supports the slide role.'),
  textCorrectness: ok('Text matches the plan, diacritics correct.'),
  issues: [],
  backgroundFix: null,
} satisfies SlideReviewModel;

export const captionReviewFixture = {
  claims: [],
  languageIssues: [],
  verdict: 'ok',
} satisfies CaptionReviewModel;

export const mockFixtures: MockFixtures = {
  'analysis.site': { ...siteFixture, __sources: siteFixtureSources },
  'analysis.instagram': instagramFixture,
  plan: planFixture,
  'review.slide': slideReviewFixture,
  'review.caption': captionReviewFixture,
};
