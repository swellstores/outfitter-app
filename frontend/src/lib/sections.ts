import type { SwellData } from '@swell/apps-sdk';

/**
 * A page's sections: what kinds there are, what each one is made of, and how a
 * merchant's saved list becomes the sections a page renders.
 *
 * Each page with sections keeps its own list in the app's settings under the
 * `sections` panel (settings/sections.json), as `sections.<page>` — only
 * `sections.home` is declared there, because the rest are the editor's alone.
 * Each item is one section:
 * `{ id, type, ...fields }`, with per-locale copy at `$locale.<code>.<field>`
 * in the dashboard's own shape. Nothing saved means the page as it was before
 * there were sections: on the home page the hero and the product grid, and on
 * a page with a required section that section by itself.
 *
 * A section may be `hidden`: it is stored and the editor shows it, but a
 * shopper's page leaves it out. Hiding every section gives shoppers an empty
 * page; deleting every section gives them the standard page again, because
 * the list is then empty. A required section can be neither.
 *
 * settings/sections.json declares every field once, for every section; the
 * lists below say which of them each type reads. Keep the two in step.
 *
 * Pure: no server imports, so the edit client can share the labels.
 */

/**
 * A section a merchant adds: the picker's contents, addable on any page, in
 * any number.
 */
export type MarketingSectionType =
  | 'hero'
  | 'text'
  | 'image_text'
  | 'cta'
  | 'products'
  | 'announcement'
  | 'prose'
  | 'features'
  | 'steps'
  | 'stats'
  | 'testimonials'
  | 'faq'
  | 'logos'
  | 'image_banner'
  | 'categories'
  | 'product_spotlight'
  | 'product_row';

/**
 * A section that is a page's reason to exist — the product page's product.
 * One per page, not in the picker, and not removable; see `anchor` below.
 */
export type AnchorSectionType = 'product_detail' | 'category_products';

export type SectionType = MarketingSectionType | AnchorSectionType;

export type SectionFieldId =
  | 'eyebrow'
  | 'heading'
  | 'body'
  | 'image'
  | 'cta_label'
  | 'cta_url'
  | 'layout'
  | 'category'
  | 'limit'
  | 'title_a'
  | 'text_a'
  | 'image_a'
  | 'title_b'
  | 'text_b'
  | 'image_b'
  | 'title_c'
  | 'text_c'
  | 'image_c'
  | 'title_d'
  | 'text_d'
  | 'image_d'
  | 'product'
  | 'align'
  | 'padding'
  | 'width'
  | 'background'
  | 'divider'
  | 'columns'
  | 'ratio'
  | 'image_fit'
  | 'overlay'
  | 'button_style'
  | 'text_position'
  | 'logo_size'
  | 'show_nav'
  | 'show_count'
  | 'numbering';

export type SectionFieldType =
  | 'text'
  | 'long_text'
  | 'image'
  | 'url'
  | 'select'
  | 'slug'
  | 'number';

export type SectionLayout = 'image_left' | 'image_right';

export interface SectionField {
  id: SectionFieldId;
  label: string;
  type: SectionFieldType;
  /** Copy: translated per locale, and edited in the page itself. */
  localized: boolean;
  options?: Array<{ value: string; label: string }>;
  /** What the section shows when nothing is stored for this field. */
  default?: string;
}

/**
 * A page that keeps its own list of sections, stored under its own key in the
 * `sections` panel. Adding one is an entry here, a `<Sections page="...">` on
 * the page itself, and — where the page is about a record — an anchor type.
 */
export type SectionPage = 'home' | 'product' | 'category';

export const SECTION_PAGES: SectionPage[] = ['home', 'product', 'category'];

export interface SectionTypeDef {
  type: SectionType;
  label: string;
  /** One line for the editor's picker. */
  description: string;
  /** The fields this type reads, in the order the editor shows them. */
  fields: SectionField[];
  /** What a freshly inserted section says. */
  template: Partial<Record<SectionFieldId, string | number>>;
  /**
   * The page this type is the required section of: the one thing that page
   * exists to show. It cannot be hidden or deleted there, and cannot appear
   * anywhere else. Merchants may still move it — a section list with a fixed
   * member is the same list, and pinning it would mean special cases through
   * every reorder path.
   */
  anchor?: SectionPage;
}

/** One section as it is stored, per-locale overrides included. */
export type StoredSection = {
  id: string;
  type: SectionType;
  /** Kept off a shopper's page; the editor still shows it. Absent when false. */
  hidden?: boolean;
  $locale?: Record<string, Record<string, string>>;
} & Partial<Record<SectionFieldId, string | number | { url: string }>>;

/** One section as a page renders it: every field present, resolved for a locale. */
export interface Section {
  id: string;
  type: SectionType;
  hidden: boolean;
  eyebrow: string;
  heading: string;
  body: string;
  image: string;
  cta_label: string;
  cta_url: string;
  layout: SectionLayout;
  category: string;
  limit: number;
  /** Item slots a–d: the points, steps, figures, quotes or marks a list section shows. */
  title_a: string;
  text_a: string;
  image_a: string;
  title_b: string;
  text_b: string;
  image_b: string;
  title_c: string;
  text_c: string;
  image_c: string;
  title_d: string;
  text_d: string;
  image_d: string;
  product: string;
  /**
   * Appearance: a non-localized choice per section, resolved to this type's
   * default, or to `''` when the type does not offer it. `sectionStyle`
   * turns whatever differs from the default into custom properties.
   */
  align: string;
  padding: string;
  width: string;
  background: string;
  divider: string;
  columns: string;
  ratio: string;
  image_fit: string;
  overlay: string;
  button_style: string;
  text_position: string;
  logo_size: string;
  show_nav: string;
  show_count: string;
  numbering: string;
}

/** Longest string a section field holds. Same cap as the copy editor's. */
const MAX_TEXT_LENGTH = 4000;
/** Most sections one page holds. */
export const MAX_SECTIONS = 20;
const MAX_LIMIT = 48;
const DEFAULT_LIMIT = 12;

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;

const LAYOUTS: Array<{ value: SectionLayout; label: string }> = [
  { value: 'image_left', label: 'Image left' },
  { value: 'image_right', label: 'Image right' },
];

// The appearance choices. Values are ids, not CSS: `sectionStyle` below is
// the only place that knows what each one renders as.
const ALIGN = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];
const PADDING = [
  { value: 'none', label: 'None' },
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
];
const WIDTH_3 = [
  { value: 'normal', label: 'Normal (measure)' },
  { value: 'wide', label: 'Wide (full container)' },
  { value: 'full', label: 'Full bleed' },
];
const WIDTH_2 = [
  { value: 'normal', label: 'Normal' },
  { value: 'full', label: 'Full bleed' },
];
const BACKGROUND = [
  { value: 'none', label: 'Page' },
  { value: 'surface', label: 'Surface tint' },
  { value: 'inverted', label: 'Inverted' },
];
const DIVIDER = [
  { value: 'line', label: 'Hairline below' },
  { value: 'none', label: 'None' },
];
const COLS_234 = [
  { value: '2', label: 'Two' },
  { value: '3', label: 'Three' },
  { value: '4', label: 'Four' },
];
const COLS_123 = [
  { value: '1', label: 'One' },
  { value: '2', label: 'Two' },
  { value: '3', label: 'Three' },
];
const RATIO = [
  { value: 'portrait', label: 'Portrait 4:5' },
  { value: 'square', label: 'Square' },
  { value: 'landscape', label: 'Landscape 16:10' },
  { value: 'wide', label: 'Wide 21:9' },
];
const FIT = [
  { value: 'cover', label: 'Fill the box' },
  { value: 'contain', label: 'Fit inside' },
];
const OVERLAY = [
  { value: 'none', label: 'None' },
  { value: 'soft', label: 'Soft scrim' },
  { value: 'strong', label: 'Strong scrim' },
];
const BUTTON = [
  { value: 'primary', label: 'Filled' },
  { value: 'outline', label: 'Outline' },
];
const POSITION = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
];
const LOGO_SIZE = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];
const SHOW = [
  { value: 'show', label: 'Show' },
  { value: 'hide', label: 'Hide' },
];
const NUMBERING = [
  { value: 'numbers', label: 'Numbered' },
  { value: 'none', label: 'None' },
];

export const SECTION_FIELDS: Record<SectionFieldId, SectionField> = {
  eyebrow: { id: 'eyebrow', label: 'Eyebrow', type: 'text', localized: true },
  heading: { id: 'heading', label: 'Heading', type: 'text', localized: true },
  body: { id: 'body', label: 'Body', type: 'long_text', localized: true },
  image: { id: 'image', label: 'Image', type: 'image', localized: false },
  cta_label: {
    id: 'cta_label',
    label: 'Button label',
    type: 'text',
    localized: true,
  },
  cta_url: { id: 'cta_url', label: 'Button link', type: 'url', localized: false },
  layout: {
    id: 'layout',
    label: 'Layout',
    type: 'select',
    localized: false,
    options: LAYOUTS,
  },
  category: {
    id: 'category',
    label: 'Category slug',
    type: 'slug',
    localized: false,
  },
  limit: {
    id: 'limit',
    label: 'Items shown',
    type: 'number',
    localized: false,
  },
  title_a: { id: 'title_a', label: 'Item A title', type: 'text', localized: true },
  text_a: { id: 'text_a', label: 'Item A text', type: 'long_text', localized: true },
  image_a: { id: 'image_a', label: 'Item A image', type: 'image', localized: false },
  title_b: { id: 'title_b', label: 'Item B title', type: 'text', localized: true },
  text_b: { id: 'text_b', label: 'Item B text', type: 'long_text', localized: true },
  image_b: { id: 'image_b', label: 'Item B image', type: 'image', localized: false },
  title_c: { id: 'title_c', label: 'Item C title', type: 'text', localized: true },
  text_c: { id: 'text_c', label: 'Item C text', type: 'long_text', localized: true },
  image_c: { id: 'image_c', label: 'Item C image', type: 'image', localized: false },
  title_d: { id: 'title_d', label: 'Item D title', type: 'text', localized: true },
  text_d: { id: 'text_d', label: 'Item D text', type: 'long_text', localized: true },
  image_d: { id: 'image_d', label: 'Item D image', type: 'image', localized: false },
  product: { id: 'product', label: 'Product slug', type: 'slug', localized: false },

  // Appearance. These are the canonical entries: `parseSectionId` tests
  // membership here, and each type's own variant is spread from them by `V`.
  align: {
    id: 'align',
    label: 'Text alignment',
    type: 'select',
    localized: false,
    options: ALIGN,
    default: 'left',
  },
  padding: {
    id: 'padding',
    label: 'Spacing',
    type: 'select',
    localized: false,
    options: PADDING,
    default: 'normal',
  },
  width: {
    id: 'width',
    label: 'Width',
    type: 'select',
    localized: false,
    options: WIDTH_3,
    default: 'normal',
  },
  background: {
    id: 'background',
    label: 'Background',
    type: 'select',
    localized: false,
    options: BACKGROUND,
    default: 'none',
  },
  divider: {
    id: 'divider',
    label: 'Divider',
    type: 'select',
    localized: false,
    options: DIVIDER,
    default: 'line',
  },
  columns: {
    id: 'columns',
    label: 'Columns',
    type: 'select',
    localized: false,
    options: COLS_234,
    default: '4',
  },
  ratio: {
    id: 'ratio',
    label: 'Image shape',
    type: 'select',
    localized: false,
    options: RATIO,
    default: 'portrait',
  },
  image_fit: {
    id: 'image_fit',
    label: 'Image fit',
    type: 'select',
    localized: false,
    options: FIT,
    default: 'cover',
  },
  overlay: {
    id: 'overlay',
    label: 'Overlay',
    type: 'select',
    localized: false,
    options: OVERLAY,
    default: 'none',
  },
  button_style: {
    id: 'button_style',
    label: 'Button style',
    type: 'select',
    localized: false,
    options: BUTTON,
    default: 'primary',
  },
  text_position: {
    id: 'text_position',
    label: 'Text position',
    type: 'select',
    localized: false,
    options: POSITION,
    default: 'bottom',
  },
  logo_size: {
    id: 'logo_size',
    label: 'Logo size',
    type: 'select',
    localized: false,
    options: LOGO_SIZE,
    default: 'medium',
  },
  show_nav: {
    id: 'show_nav',
    label: 'Category row',
    type: 'select',
    localized: false,
    options: SHOW,
    default: 'show',
  },
  show_count: {
    id: 'show_count',
    label: 'Product count',
    type: 'select',
    localized: false,
    options: SHOW,
    default: 'show',
  },
  numbering: {
    id: 'numbering',
    label: 'Step numbers',
    type: 'select',
    localized: false,
    options: NUMBERING,
    default: 'numbers',
  },
};

// A neutral 4:5 placeholder, drawn in the house palette, for an image and
// text section the merchant has not given a picture yet.
const PLACEHOLDER_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 1000'%3E%3Crect width='800' height='1000' fill='%23181818'/%3E%3Crect x='80' y='80' width='640' height='840' fill='none' stroke='%233f3f3f' stroke-width='2'/%3E%3Ccircle cx='400' cy='500' r='120' fill='none' stroke='%233f3f3f' stroke-width='2'/%3E%3C/svg%3E";

const F = SECTION_FIELDS;

/** The same field with this type's own label, options or default. */
const V = (field: SectionField, over: Partial<SectionField>): SectionField => ({
  ...field,
  ...over,
});

/**
 * Adding a field here is only half the job, and the other half costs
 * something: settings/sections.json declares the `home` collection's fields
 * flat, once for every type, because the schema has no per-type field list.
 * So the dashboard offers every field on every section, while `readItem`'s
 * `allowed` set — built from the type's own list below — drops anything the
 * type does not declare. Through `normaliseSections` that drop is silent:
 * a merchant who sets `background` on a products section in the dashboard
 * loses it the next time the list is read back. Declare a new field for a
 * type here and in settings/sections.json together, and say in that field's
 * description which types read it.
 */
export const SECTION_TYPES: SectionTypeDef[] = [
  {
    type: 'hero',
    label: 'Hero',
    description: 'The opening statement: an eyebrow, a display heading and a line beneath.',
    fields: [
      F.eyebrow,
      F.heading,
      F.body,
      F.image,
      V(F.overlay, { default: 'soft' }),
      F.align,
      F.width,
      F.padding,
      F.background,
      F.divider,
    ],
    template: {
      eyebrow: 'Printed on demand',
      heading: 'Company merch.',
      body: 'Made to order and shipped worldwide.',
    },
  },
  {
    type: 'text',
    label: 'Text',
    description: 'A short statement on its own — a heading and a paragraph.',
    fields: [F.eyebrow, F.heading, F.body, F.align, F.width, F.padding, F.background, F.divider],
    template: {
      eyebrow: 'How it works',
      heading: 'Made in small runs.',
      body: 'Every piece is printed when it is ordered, so nothing sits in a warehouse. Order one, or one for everyone.',
    },
  },
  {
    type: 'image_text',
    label: 'Image and text',
    description: 'A picture beside a heading and a paragraph, on whichever side you choose.',
    fields: [
      F.eyebrow,
      F.heading,
      F.body,
      F.image,
      F.layout,
      V(F.ratio, { default: 'portrait' }),
      V(F.image_fit, { default: 'cover' }),
      F.align,
      V(F.width, { options: WIDTH_2 }),
      F.padding,
      F.background,
      F.divider,
    ],
    template: {
      eyebrow: 'The print',
      heading: 'Your mark, on the good stuff.',
      body: 'Tees, hoodies, hats and mugs, printed to order and shipped straight to the team.',
      image: PLACEHOLDER_IMAGE,
      layout: 'image_left',
    },
  },
  {
    type: 'cta',
    label: 'Call to action',
    description: 'A heading with one button — the place to send people next.',
    fields: [
      F.heading,
      F.cta_label,
      F.cta_url,
      F.button_style,
      F.align,
      V(F.width, { options: WIDTH_2 }),
      F.padding,
      F.background,
      F.divider,
    ],
    template: {
      heading: 'Get the team kitted out.',
      cta_label: 'Shop the collection',
      cta_url: '/',
    },
  },
  {
    type: 'products',
    label: 'Products',
    description: 'The category row and a grid of products — the newest, or one category.',
    fields: [
      F.heading,
      F.category,
      F.limit,
      V(F.columns, { default: '4' }),
      F.show_nav,
      F.show_count,
      V(F.align, { label: 'Heading alignment' }),
      V(F.width, { options: WIDTH_2 }),
      F.padding,
      V(F.divider, { default: 'none' }),
    ],
    template: { heading: 'Latest', category: '', limit: DEFAULT_LIMIT },
  },
  {
    type: 'announcement',
    label: 'Announcement bar',
    description: 'One line in a slim strip — a shipping threshold or a drop date — with an optional link.',
    fields: [
      F.heading,
      F.cta_label,
      F.cta_url,
      V(F.align, { default: 'center' }),
      V(F.width, { options: WIDTH_2 }),
      F.padding,
      F.background,
      F.divider,
    ],
    template: {
      heading: 'Free shipping on team orders of 25 or more.',
      cta_label: 'See details',
      cta_url: '/',
    },
  },
  {
    type: 'prose',
    label: 'Long text',
    description: 'Several paragraphs beside a heading — the story, the studio, the process.',
    fields: [F.eyebrow, F.heading, F.body, F.align, F.width, F.padding, F.background, F.divider],
    template: {
      eyebrow: 'About',
      heading: 'Printed, not stocked.',
      body: 'We started Outfitter because company merch was either a garage full of boxes or a minimum order of two hundred.\n\nNow every piece is printed when someone orders it, in a print shop near them. There is no warehouse and nothing gets thrown away at the end of the season.\n\nThe blanks are the same ones the big brands use. The print is the part that is yours.',
    },
  },
  {
    type: 'features',
    label: 'Features',
    description: 'Up to four short points side by side, each a title and a line.',
    fields: [
      F.eyebrow,
      F.heading,
      F.title_a,
      F.text_a,
      F.title_b,
      F.text_b,
      F.title_c,
      F.text_c,
      F.title_d,
      F.text_d,
      V(F.columns, { default: '4' }),
      F.align,
      F.width,
      F.padding,
      F.background,
      F.divider,
    ],
    template: {
      eyebrow: 'Why us',
      heading: 'Made to order, made right.',
      title_a: 'No minimums',
      text_a: 'Order one for a new hire or two hundred for the offsite. The price is the price.',
      title_b: 'Printed on demand',
      text_b: 'Nothing is made until it is ordered, so nothing ends up in a box under a desk.',
      title_c: 'Shipped worldwide',
      text_c: 'Fulfilled near the recipient and delivered to the team wherever they work.',
      title_d: 'Your files, your mark',
      text_d: 'Upload the logo once. Every product carries it, in the right size and place.',
    },
  },
  {
    type: 'steps',
    label: 'Steps',
    description: 'A numbered how-it-works in three steps.',
    fields: [
      F.eyebrow,
      F.heading,
      F.title_a,
      F.text_a,
      F.title_b,
      F.text_b,
      F.title_c,
      F.text_c,
      F.numbering,
      F.align,
      F.width,
      F.padding,
      F.background,
      F.divider,
    ],
    template: {
      eyebrow: 'How it works',
      heading: 'Three steps, then the post.',
      title_a: 'Pick the piece',
      text_a: 'Tees, hoodies, hats, mugs — choose the blank and the colour.',
      title_b: 'Add your mark',
      text_b: 'Upload the artwork once; it sits on every product you pick.',
      title_c: 'We print and ship',
      text_c: 'Each order is printed on demand and posted within a few days.',
    },
  },
  {
    type: 'stats',
    label: 'Stats',
    description: 'Up to four big figures with a label under each.',
    fields: [
      F.eyebrow,
      F.heading,
      F.title_a,
      F.text_a,
      F.title_b,
      F.text_b,
      F.title_c,
      F.text_c,
      F.title_d,
      F.text_d,
      V(F.columns, { default: '4' }),
      F.align,
      F.width,
      F.padding,
      F.background,
      F.divider,
    ],
    template: {
      eyebrow: 'By the numbers',
      heading: 'Small runs, big reach.',
      title_a: '2,400+',
      text_a: 'Team orders shipped',
      title_b: '40',
      text_b: 'Countries delivered to',
      title_c: '5 days',
      text_c: 'Average turnaround',
      title_d: '0',
      text_d: 'Boxes sitting in storage',
    },
  },
  {
    type: 'testimonials',
    label: 'Testimonials',
    description: 'Up to three quotes from customers, each with who said it.',
    fields: [
      F.eyebrow,
      F.heading,
      F.text_a,
      F.title_a,
      F.text_b,
      F.title_b,
      F.text_c,
      F.title_c,
      V(F.columns, { options: COLS_123, default: '3' }),
      F.align,
      F.width,
      F.padding,
      F.background,
      F.divider,
    ],
    template: {
      eyebrow: 'What teams say',
      heading: 'Worn on Fridays, and every other day.',
      text_a: 'The hoodies showed up before the offsite and nobody has taken them off since.',
      title_a: 'Maya, People Ops',
      text_b: 'Ordering one at a time for new starters is the feature we did not know we needed.',
      title_b: 'Jonas, Engineering',
      text_c: 'Forty hoodies to three countries and every one of them fit.',
      title_c: 'Priya, Brand',
    },
  },
  {
    type: 'faq',
    label: 'FAQ',
    description: 'Up to four questions and their answers, all in view.',
    fields: [
      F.eyebrow,
      F.heading,
      F.body,
      F.title_a,
      F.text_a,
      F.title_b,
      F.text_b,
      F.title_c,
      F.text_c,
      F.title_d,
      F.text_d,
      F.align,
      F.width,
      F.padding,
      F.background,
      F.divider,
    ],
    template: {
      eyebrow: 'Good to know',
      heading: 'Questions, answered.',
      body: 'Anything else, write to us and a person replies.',
      title_a: 'How long does an order take?',
      text_a: 'Most orders print within two business days and ship right after. Delivery depends on where the team is.',
      title_b: 'Is there a minimum order?',
      text_b: 'No. One tee or one hundred, the price per item is the same.',
      title_c: 'Can I return something?',
      text_c: 'Everything is printed to order, so we can only take back items that arrive damaged or misprinted. Get in touch and we will sort it out.',
      title_d: 'Do you ship internationally?',
      text_d: 'Yes. Orders are fulfilled close to the recipient, so international shipping is usually as quick as domestic.',
    },
  },
  {
    type: 'logos',
    label: 'Logo strip',
    description: 'A line and up to four names or marks of the teams that wear you.',
    fields: [
      F.heading,
      F.title_a,
      F.image_a,
      F.title_b,
      F.image_b,
      F.title_c,
      F.image_c,
      F.title_d,
      F.image_d,
      F.logo_size,
      V(F.align, { label: 'Alignment' }),
      V(F.width, { options: WIDTH_2 }),
      F.padding,
      F.background,
      F.divider,
    ],
    template: {
      heading: 'Worn by teams at',
      title_a: 'Acme',
      image_a: '',
      title_b: 'Northwind',
      image_b: '',
      title_c: 'Globex',
      image_c: '',
      title_d: 'Initech',
      image_d: '',
    },
  },
  {
    type: 'image_banner',
    label: 'Image banner',
    description: 'A wide picture with a heading, a line and a button laid over it.',
    fields: [
      F.eyebrow,
      F.heading,
      F.body,
      F.image,
      F.cta_label,
      F.cta_url,
      V(F.ratio, { default: 'wide' }),
      V(F.overlay, { default: 'soft' }),
      F.text_position,
      F.button_style,
      F.align,
      V(F.width, { options: WIDTH_2 }),
      F.padding,
      F.divider,
    ],
    template: {
      eyebrow: 'New this season',
      heading: 'The autumn drop.',
      body: 'Heavier fleece, three new colours, the same print.',
      image: '',
      cta_label: 'Shop the drop',
      cta_url: '/',
    },
  },
  {
    type: 'categories',
    label: 'Categories',
    description: 'Every category as a tile, each linking to its page.',
    fields: [
      F.eyebrow,
      F.heading,
      F.limit,
      V(F.columns, { default: '4' }),
      V(F.ratio, { label: 'Tile shape', default: 'square' }),
      F.align,
      V(F.width, { options: WIDTH_2 }),
      F.padding,
      F.divider,
    ],
    template: { eyebrow: 'Browse', heading: 'Shop by category.', limit: 4 },
  },
  {
    type: 'product_spotlight',
    label: 'Product spotlight',
    description: 'One product, large: its picture, name and price beside your copy and a button.',
    fields: [
      F.eyebrow,
      F.heading,
      F.body,
      F.cta_label,
      F.product,
      F.layout,
      V(F.ratio, { default: 'portrait' }),
      V(F.image_fit, { default: 'contain' }),
      F.button_style,
      F.align,
      V(F.width, { options: WIDTH_2 }),
      F.padding,
      F.background,
      F.divider,
    ],
    template: {
      eyebrow: 'Staff pick',
      heading: 'The one we wear.',
      body: 'Heavyweight, boxy, printed front and back. Order one and see.',
      cta_label: 'View the product',
      product: '',
      layout: 'image_left',
    },
  },
  {
    type: 'product_row',
    label: 'Product row',
    description: 'A short row of products — the newest, or one category — with a link to see all.',
    fields: [
      F.heading,
      F.cta_label,
      F.cta_url,
      F.category,
      F.limit,
      V(F.columns, { default: '4' }),
      V(F.align, { label: 'Heading alignment' }),
      V(F.width, { options: WIDTH_2 }),
      F.padding,
      F.divider,
    ],
    template: { heading: 'Best sellers', cta_label: 'View all', cta_url: '', category: '', limit: 4 },
  },
  {
    type: 'product_detail',
    label: 'Product detail',
    description: 'The product itself: its pictures, price, options and add to cart.',
    anchor: 'product',
    // Nothing to set: what it shows is the product. Appearance is the store's
    // theme, as it was before the product page had sections.
    fields: [],
    template: {},
  },
  {
    type: 'category_products',
    label: 'Category products',
    description: 'The category itself: its name, its description and the products in it.',
    anchor: 'category',
    fields: [],
    template: {},
  },
];

const TYPES_BY_ID = new Map(SECTION_TYPES.map((def) => [def.type, def]));

/** The type each page requires, derived from the declarations themselves. */
const ANCHOR_OF = new Map<SectionPage, SectionType>(
  SECTION_TYPES.filter((def) => def.anchor).map((def) => [
    def.anchor as SectionPage,
    def.type,
  ]),
);

export const ANCHOR_TYPES = new Set<SectionType>(ANCHOR_OF.values());

/**
 * Puts a page's required section back however the list arrived: missing,
 * duplicated, hidden, renamed, or carrying another page's anchor. Read-side
 * repair rather than a write-side rule, because a list can reach a shopper
 * from the dashboard, from an older release, or from a hand-edited settings
 * panel — and a page whose reason to exist has been edited away should still
 * render it.
 */
function repairAnchors(list: StoredSection[], page: SectionPage): StoredSection[] {
  const type = ANCHOR_OF.get(page);
  let seen = false;

  const kept = list.filter((item) => {
    if (!ANCHOR_TYPES.has(item.type)) {
      // An ordinary section sitting on the id the anchor is about to claim
      // would leave two items answering to one id, which every lookup here
      // resolves by position. The stranger yields the name.
      if (type && item.id === type) {
        item.id = `${type}-section`;
      }
      return true;
    }
    // Another page's anchor, or a second copy of this one.
    if (item.type !== type || seen) {
      return false;
    }
    seen = true;
    delete item.hidden;
    item.id = type;
    return true;
  });

  if (type && !seen) {
    const def = SECTION_TYPES.find((entry) => entry.type === type);
    kept.unshift({ id: type, type, ...def?.template } as StoredSection);
    // The anchor is not optional, so it is the cap that gives: a list already
    // at the limit loses its last section rather than its reason to exist.
    if (kept.length > MAX_SECTIONS) {
      kept.length = MAX_SECTIONS;
    }
  }

  return kept;
}

/** Type label by type id, for the edit client's corner labels. */
export const SECTION_LABELS: Record<SectionType, string> = Object.fromEntries(
  SECTION_TYPES.map((def) => [def.type, def.label]),
) as Record<SectionType, string>;

/**
 * The home page with nothing saved: exactly what it showed before sections.
 * Seeded from the legacy content fields below when a store set them, so
 * that copy survives; see `pageSections`.
 */
export const DEFAULT_HOME: StoredSection[] = [
  {
    id: 'hero',
    type: 'hero',
    eyebrow: 'Printed on demand',
    heading: 'Company merch.',
    body: 'Made to order and shipped worldwide.',
  },
  {
    id: 'products',
    type: 'products',
    heading: 'Latest',
    category: '',
    limit: DEFAULT_LIMIT,
  },
];

/**
 * Before sections, the hero and the product grid's heading were fields of
 * the `content` panel. A store that changed them still holds the values
 * there — in the default locale at `content.<id>`, per locale at
 * `content.$locale.<code>.<id>` — and the default sections carry them.
 */
const LEGACY_CONTENT: Record<string, Partial<Record<SectionFieldId, string>>> = {
  hero: {
    eyebrow: 'home_hero_eyebrow',
    heading: 'home_hero_title',
    body: 'home_hero_lede',
  },
  products: { heading: 'home_latest_title' },
};

/** The default sections, with whatever the legacy content fields still say. */
function defaultHome(content: unknown): StoredSection[] {
  const panel = isRecord(content) ? content : {};
  const locales = isRecord(panel.$locale) ? panel.$locale : {};

  return normaliseSections(
    DEFAULT_HOME.map((item) => {
      const seeded: StoredSection = { ...item };

      for (const [field, contentId] of Object.entries(LEGACY_CONTENT[item.id] ?? {})) {
        const value = nonEmpty(panel[contentId]);

        if (value !== undefined) {
          seeded[field as SectionFieldId] = value;
        }

        for (const [code, values] of Object.entries(locales)) {
          const override = isRecord(values) ? nonEmpty(values[contentId]) : undefined;

          if (override !== undefined) {
            seeded.$locale = { ...seeded.$locale };
            seeded.$locale[code] = { ...seeded.$locale[code], [field]: override };
          }
        }
      }

      return seeded;
    }),
  );
}

export function sectionType(type: unknown): SectionTypeDef | undefined {
  return typeof type === 'string' ? TYPES_BY_ID.get(type as SectionType) : undefined;
}

/** The field a section of this type reads under this name, if it does. */
export function sectionFieldOf(
  type: SectionType,
  field: string,
): SectionField | undefined {
  return TYPES_BY_ID.get(type)?.fields.find((entry) => entry.id === field);
}

/** Splits a copy id of the form `sec:<section id>:<field>`. */
export function parseSectionId(
  id: string,
): { itemId: string; field: SectionFieldId } | undefined {
  const match = /^sec:([a-z0-9][a-z0-9_-]{0,39}):([a-z_]+)$/.exec(id);

  if (!match || !(match[2] in SECTION_FIELDS)) {
    return undefined;
  }

  return { itemId: match[1], field: match[2] as SectionFieldId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export type ValueCheck =
  | { ok: true; value: string | number | { url: string } }
  | { ok: false; error: string };

/**
 * Checks one submitted field value against its declared type and returns the
 * value to store. Strings are capped; a `limit` may arrive as a numeric
 * string, from a form field.
 */
export function checkSectionValue(field: SectionField, raw: unknown): ValueCheck {
  switch (field.type) {
    case 'text':
    case 'long_text':
      return typeof raw === 'string' && raw.length <= MAX_TEXT_LENGTH
        ? { ok: true, value: raw }
        : { ok: false, error: `expected text up to ${MAX_TEXT_LENGTH} characters` };

    case 'image': {
      // The dashboard stores an uploaded file record and reads its `url`; the
      // editor takes a URL. Either shape is kept as it came, minus anything
      // else the record carried.
      const url = isRecord(raw) ? raw.url : raw;

      if (typeof url !== 'string' || url.length > MAX_TEXT_LENGTH) {
        return { ok: false, error: 'expected an image URL' };
      }

      if (url === '') {
        return { ok: true, value: '' };
      }

      if (!isHttpUrl(url) && !url.startsWith('data:image/')) {
        return { ok: false, error: 'expected an http(s) or data:image URL' };
      }

      return { ok: true, value: isRecord(raw) ? { url } : url };
    }

    case 'url': {
      if (typeof raw !== 'string' || raw.length > MAX_TEXT_LENGTH) {
        return { ok: false, error: 'expected a link' };
      }

      const value = raw.trim();
      const path = value.startsWith('/') && !value.startsWith('//');

      return value === '' || path || isHttpUrl(value)
        ? { ok: true, value }
        : { ok: false, error: 'expected a path on this store or an http(s) URL' };
    }

    case 'select':
      return typeof raw === 'string' &&
        field.options?.some((option) => option.value === raw)
        ? { ok: true, value: raw }
        : { ok: false, error: `expected one of ${field.options?.map((o) => o.value).join(', ')}` };

    case 'slug': {
      if (typeof raw !== 'string' || raw.length > 200) {
        return { ok: false, error: 'expected a slug' };
      }

      const value = raw.trim();

      return value === '' || SLUG_PATTERN.test(value)
        ? { ok: true, value }
        : { ok: false, error: 'expected a slug: lowercase letters, digits and dashes' };
    }

    case 'number': {
      const number =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'string' && raw.trim() !== ''
            ? Number(raw)
            : NaN;

      return Number.isInteger(number) && number >= 1 && number <= MAX_LIMIT
        ? { ok: true, value: number }
        : { ok: false, error: `expected a whole number from 1 to ${MAX_LIMIT}` };
    }
  }
}

/**
 * Reads one saved item into a clean section. With `errors` given, anything
 * off is reported and nothing is dropped silently; without it, whatever
 * cannot be used is left out and the rest is kept — a page still renders
 * around a field the dashboard saved oddly.
 */
function readItem(
  raw: unknown,
  index: number,
  seen: Set<string>,
  errors?: string[],
): StoredSection | undefined {
  const at = `sections[${index}]`;

  if (!isRecord(raw)) {
    errors?.push(`${at}: expected an object`);
    return undefined;
  }

  const def = sectionType(raw.type);

  if (!def) {
    errors?.push(`${at}.type: unknown section type`);
    return undefined;
  }

  const allowed = new Set<string>(['id', 'type', '$locale', 'hidden', ...def.fields.map((f) => f.id)]);

  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      errors?.push(`${at}.${key}: not a field of a ${def.label.toLowerCase()} section`);
    }
  }

  let id = typeof raw.id === 'string' && ID_PATTERN.test(raw.id) ? raw.id : '';

  if (raw.id !== undefined && raw.id !== '' && raw.id !== null && !id) {
    errors?.push(`${at}.id: expected lowercase letters, digits, dashes and underscores`);
  }

  if (id && seen.has(id)) {
    errors?.push(`${at}.id: "${id}" is used twice`);
    id = '';
  }

  // No usable id: one from the position, so the same list always gets the
  // same ids and the editor can address a section the dashboard created.
  if (!id) {
    let n = index + 1;

    do {
      id = `${def.type}-${n}`;
      n += 1;
    } while (seen.has(id));
  }

  seen.add(id);

  const item: StoredSection = { id, type: def.type };

  for (const field of def.fields) {
    const value = raw[field.id];

    if (value === undefined || value === null) {
      continue;
    }

    const check = checkSectionValue(field, value);

    if (check.ok) {
      item[field.id] = check.value;
    } else {
      errors?.push(`${at}.${field.id}: ${check.error}`);
    }
  }

  // The dashboard's toggle writes an explicit false; only true is stored.
  if (raw.hidden === true) {
    item.hidden = true;
  } else if (raw.hidden !== undefined && raw.hidden !== null && raw.hidden !== false) {
    errors?.push(`${at}.hidden: expected true or false`);
  }

  if (raw.$locale !== undefined) {
    const locales = readLocales(raw.$locale, def, at, errors);

    if (locales) {
      item.$locale = locales;
    }
  }

  return item;
}

/** The per-locale copy of one item, only for the fields its type translates. */
function readLocales(
  raw: unknown,
  def: SectionTypeDef,
  at: string,
  errors?: string[],
): Record<string, Record<string, string>> | undefined {
  if (!isRecord(raw)) {
    errors?.push(`${at}.$locale: expected an object`);
    return undefined;
  }

  const locales: Record<string, Record<string, string>> = {};

  for (const [code, values] of Object.entries(raw)) {
    if (!LOCALE_PATTERN.test(code)) {
      errors?.push(`${at}.$locale.${code}: not a locale code`);
      continue;
    }

    if (!isRecord(values)) {
      errors?.push(`${at}.$locale.${code}: expected an object`);
      continue;
    }

    const overrides: Record<string, string> = {};

    for (const [key, value] of Object.entries(values)) {
      const field = def.fields.find((entry) => entry.id === key && entry.localized);

      if (!field) {
        errors?.push(`${at}.$locale.${code}.${key}: not translated copy of a ${def.label.toLowerCase()} section`);
        continue;
      }

      if (value === '' || value === null || value === undefined) {
        continue;
      }

      const check = checkSectionValue(field, value);

      if (check.ok) {
        overrides[key] = check.value as string;
      } else {
        errors?.push(`${at}.$locale.${code}.${key}: ${check.error}`);
      }
    }

    if (Object.keys(overrides).length > 0) {
      locales[code] = overrides;
    }
  }

  return Object.keys(locales).length > 0 ? locales : undefined;
}

/**
 * A saved list as clean sections: unknown types dropped, ids filled in,
 * fields the type does not read left out, values it cannot use ignored.
 * Always fresh objects, so callers may write to them.
 */
export function normaliseSections(raw: unknown): StoredSection[] {
  const seen = new Set<string>();
  const items = Array.isArray(raw) ? raw : [];

  return items
    .map((entry, index) => readItem(entry, index, seen))
    .filter((item): item is StoredSection => item !== undefined);
}

export type SectionsCheck =
  | { ok: true; sections: StoredSection[] }
  | { ok: false; errors: string[] };

/**
 * Checks a whole list as the editor submits it. Strict where `normaliseSections`
 * is forgiving: an unknown type, a field the type does not read, a value of
 * the wrong shape or a duplicate id each fail the request, so the editor
 * never saves something the page would then quietly drop.
 */
export function validateSections(input: unknown, page: SectionPage): SectionsCheck {
  if (!SECTION_PAGES.includes(page)) {
    return { ok: false, errors: [`sections: unknown page ${page}`] };
  }

  if (!Array.isArray(input)) {
    return { ok: false, errors: ['sections: expected a list'] };
  }

  if (input.length > MAX_SECTIONS) {
    return { ok: false, errors: [`sections: at most ${MAX_SECTIONS} sections`] };
  }

  const errors: string[] = [];
  const seen = new Set<string>();
  const sections: StoredSection[] = [];

  input.forEach((entry, index) => {
    const item = readItem(entry, index, seen, errors);

    if (item) {
      sections.push(item);
    }
  });

  // The anchor is the page, so the client is not trusted to keep it: a list
  // that would leave the page unable to do its job is refused rather than
  // quietly repaired, which is the read path's job and not the writer's.
  const anchor = ANCHOR_OF.get(page);
  const anchors = sections.filter((item) => ANCHOR_TYPES.has(item.type));

  for (const item of anchors) {
    if (item.type !== anchor) {
      errors.push(`sections: ${item.type} does not belong on ${page}`);
    }
  }

  if (anchor) {
    const own = anchors.filter((item) => item.type === anchor);

    if (own.length !== 1) {
      errors.push(`sections: ${page} needs exactly one ${anchor}`);
    } else if (own[0].hidden) {
      errors.push(`sections: ${anchor} cannot be hidden`);
    } else if (own[0].id !== anchor) {
      errors.push(`sections: ${anchor} keeps its own id`);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, sections };
}

/**
 * The home page's stored sections, or the defaults when the merchant has
 * saved none — an empty list included, so removing every section brings the
 * standard page back rather than a blank one. `panel` is the `sections`
 * settings panel and `content` the `content` panel, whether read raw or
 * through `getAppSettings()`; the defaults carry the hero and grid copy a
 * store set in `content` before there were sections.
 */
export function pageSections(
  panel: unknown,
  page: SectionPage,
  content?: unknown,
): StoredSection[] {
  const raw = isRecord(panel) ? panel[page] : undefined;
  const stored = Array.isArray(raw) && raw.length > 0 ? normaliseSections(raw) : [];

  // A page with an anchor always has a list, because the anchor is one.
  if (ANCHOR_OF.has(page)) {
    return repairAnchors(stored, page);
  }

  if (stored.length > 0) {
    return stored;
  }

  // Only the home page has defaults to fall back on — which is how deleting
  // every section brings the standard page back rather than a blank one. Any
  // other anchorless page renders nothing rather than inheriting the home
  // page's hero and product grid.
  return page === 'home' ? defaultHome(content) : [];
}

/**
 * The sections a page renders, with every field resolved for `locale` the
 * way copy is: `$locale.<code>` → `$locale.<language>` → the item itself.
 */
export function getSections(
  app: SwellData | null | undefined,
  page: SectionPage,
  locale: string,
): Section[] {
  return pageSections(app?.sections, page, app?.content).map((item) =>
    resolveSection(item, locale),
  );
}

function resolveSection(item: StoredSection, locale: string): Section {
  const language = locale.split(/[-_]/)[0];
  const exact = item.$locale?.[locale];
  const byLanguage = language !== locale ? item.$locale?.[language] : undefined;

  const copy = (field: SectionFieldId): string =>
    nonEmpty(exact?.[field]) ??
    nonEmpty(byLanguage?.[field]) ??
    (typeof item[field] === 'string' ? (item[field] as string) : '');

  // An image is a URL from the editor or an uploaded file record from the
  // dashboard; either way the page wants the URL.
  const picture = (field: SectionFieldId): string => {
    const value = item[field];
    return typeof value === 'string' ? value : isRecord(value) ? value.url : '';
  };

  /** A non-localized choice: what is stored, else this type's default. */
  const setting = (field: SectionFieldId): string => {
    const raw = item[field];

    if (typeof raw === 'string' && raw !== '') {
      return raw;
    }

    return sectionFieldOf(item.type, field)?.default ?? '';
  };

  return {
    id: item.id,
    type: item.type,
    hidden: item.hidden === true,
    eyebrow: copy('eyebrow'),
    heading: copy('heading'),
    body: copy('body'),
    image: picture('image'),
    cta_label: copy('cta_label'),
    cta_url: typeof item.cta_url === 'string' ? item.cta_url : '',
    layout: item.layout === 'image_right' ? 'image_right' : 'image_left',
    category: typeof item.category === 'string' ? item.category : '',
    limit: typeof item.limit === 'number' ? item.limit : DEFAULT_LIMIT,
    title_a: copy('title_a'),
    text_a: copy('text_a'),
    image_a: picture('image_a'),
    title_b: copy('title_b'),
    text_b: copy('text_b'),
    image_b: picture('image_b'),
    title_c: copy('title_c'),
    text_c: copy('text_c'),
    image_c: picture('image_c'),
    title_d: copy('title_d'),
    text_d: copy('text_d'),
    image_d: picture('image_d'),
    product: typeof item.product === 'string' ? item.product : '',
    align: setting('align'),
    padding: setting('padding'),
    width: setting('width'),
    background: setting('background'),
    divider: setting('divider'),
    columns: setting('columns'),
    ratio: setting('ratio'),
    image_fit: setting('image_fit'),
    overlay: setting('overlay'),
    button_style: setting('button_style'),
    text_position: setting('text_position'),
    logo_size: setting('logo_size'),
    show_nav: setting('show_nav'),
    show_count: setting('show_count'),
    numbering: setting('numbering'),
  };
}

const RATIO_CSS: Record<string, string> = {
  portrait: '4 / 5',
  square: '1 / 1',
  landscape: '16 / 10',
  wide: '21 / 9',
};

// What each shape collapses to under 900px, mirroring today's rule: the wide
// and square boxes go square, the tall and letterbox ones go 16:10.
const RATIO_SM: Record<string, string> = {
  portrait: '16 / 10',
  square: '1 / 1',
  landscape: '16 / 10',
  wide: '1 / 1',
};

const LOGO_HEIGHTS: Record<string, string> = {
  small: '1.25rem',
  medium: '1.75rem',
  large: '2.5rem',
};

/**
 * A URL safe to drop inside `url("…")` in a stylesheet, or `''`.
 *
 * `checkSectionValue` only promises http(s) or `data:image/`, which still
 * leaves room for a quote or a brace that would end the declaration and
 * start something else. Anything that survives `encodeURI` and could still
 * break out is refused rather than escaped.
 */
function cssUrl(raw: string): string {
  const url = encodeURI(raw);

  return /["'()\\;{}]|\s/.test(url) ? '' : url;
}

/**
 * The custom properties one section needs, as a declaration body — e.g.
 * `--sec-align:center;--sec-items:center`. Only what differs from the
 * type's own default is emitted, so a store that has never touched a
 * setting renders byte-identical CSS to before there were any.
 *
 * The names are consumed by static rules in layouts/Layout.astro, each of
 * which keeps today's value as its `var()` fallback.
 */
export function sectionStyle(section: Section): string {
  const out: string[] = [];

  /** The stored choice, or `''` when it is the default or not offered. */
  const at = (id: SectionFieldId): string => {
    const field = sectionFieldOf(section.type, id);
    const value = section[id];

    if (!field || typeof value !== 'string' || value === '') {
      return '';
    }

    return value === (field.default ?? '') ? '' : value;
  };

  const align = at('align');

  if (align === 'center') {
    out.push(
      '--sec-align:center',
      '--sec-items:center',
      '--sec-justify:center',
      '--sec-lead-mi:auto',
    );
  } else if (align === 'right') {
    out.push(
      '--sec-align:right',
      '--sec-items:flex-end',
      '--sec-justify:flex-end',
      // margin-inline takes one or two values; four is a parse error and the
      // whole declaration is dropped. Start auto, end 0: pushed to the right.
      '--sec-lead-mi:auto 0',
    );
  } else if (align === 'left') {
    out.push('--sec-align:left', '--sec-items:flex-start', '--sec-justify:flex-start');
  }

  // A multiplier, not a length, so every type keeps its own base padding.
  const padding = at('padding');

  if (padding === 'none') {
    out.push('--sec-pad-k:0');
  } else if (padding === 'small') {
    out.push('--sec-pad-k:0.5');
  } else if (padding === 'large') {
    out.push('--sec-pad-k:1.5');
  }

  // Width and background both want the inline padding back; work out the
  // bleed and the padding once so neither is emitted twice.
  const width = at('width');
  const background = at('background');
  let marginInline = '';
  let paddingInline = '';

  if (width === 'wide' || width === 'full') {
    out.push('--sec-measure:none');
  }

  if (width === 'full') {
    marginInline = 'calc(50% - 50vw)';
    paddingInline = 'var(--pad)';
  }

  if (background === 'surface') {
    out.push('--sec-bg:var(--color-surface)');
  } else if (background === 'inverted') {
    out.push(
      '--sec-bg:var(--color-primary)',
      '--sec-fg:var(--color-secondary)',
      '--sec-muted:color-mix(in srgb, var(--color-secondary) 65%, transparent)',
    );
  }

  if (background !== '' && width !== 'full') {
    paddingInline = 'var(--pad)';
  }

  if (marginInline) {
    out.push(`--sec-mi:${marginInline}`);
  }

  if (paddingInline) {
    out.push(`--sec-pi:${paddingInline}`);
  }

  const divider = at('divider');

  if (divider === 'none') {
    out.push('--sec-rule:0');
  } else if (divider === 'line') {
    out.push('--sec-rule:1px');
  }

  const columns = at('columns');

  if (columns) {
    // The narrow-screen count travels with it, capped at two: the stylesheet
    // cannot do `min()` inside `repeat()`, and only here is the number known.
    const count = Number(columns);

    out.push(`--sec-cols:${columns}`);

    if (Number.isFinite(count)) {
      out.push(`--sec-cols-sm:${Math.min(count, 2)}`);
    }
  }

  const ratio = at('ratio');

  if (ratio && RATIO_CSS[ratio]) {
    out.push(`--sec-ratio:${RATIO_CSS[ratio]}`, `--sec-ratio-sm:${RATIO_SM[ratio]}`);
  }

  const fit = at('image_fit');

  if (fit) {
    out.push(`--sec-fit:${fit}`);
  }

  // Unitless: the CSS multiplies by 1%.
  const overlay = at('overlay');

  if (overlay === 'none') {
    out.push('--sec-scrim:0');
  } else if (overlay === 'soft') {
    out.push('--sec-scrim:85');
  } else if (overlay === 'strong') {
    out.push('--sec-scrim:100');
  }

  if (at('button_style') === 'outline') {
    out.push('--sec-btn-bg:transparent', '--sec-btn-fg:var(--color-primary)');
  }

  // The scrim has to follow the copy: it is opaque at one edge, and moving
  // the copy off that edge would leave it on the bare picture.
  const position = at('text_position');

  if (position === 'top') {
    out.push('--sec-overlay-inset:0 0 auto 0', '--sec-scrim-dir:to bottom');
  } else if (position === 'middle') {
    out.push(
      '--sec-overlay-inset:0',
      '--sec-overlay-justify:center',
      // Centred copy needs a centred band, not an edge wash — both edges stay
      // clear so the picture is still the picture.
      '--sec-scrim-grad:linear-gradient(to bottom, transparent, var(--sec-scrim-c) 30%, var(--sec-scrim-c) 70%, transparent)',
    );
  }

  const logo = at('logo_size');

  if (logo && LOGO_HEIGHTS[logo]) {
    out.push(`--sec-logo-h:${LOGO_HEIGHTS[logo]}`);
  }

  if (at('show_nav') === 'hide') {
    out.push('--sec-nav:none');
  }

  if (at('show_count') === 'hide') {
    out.push('--sec-count:none');
  }

  if (at('numbering') === 'none') {
    out.push('--sec-step-num:none');
  }

  // The hero's picture is a background, not an <img>: it sits behind copy
  // the section already renders, under the scrim the overlay setting asks
  // for. Every other type shows its image in the markup.
  if (section.type === 'hero' && section.image !== '') {
    const url = cssUrl(section.image);

    if (url) {
      out.push(`--sec-image:url("${url}")`);

      // Not image_banner's wash: that one is opaque at the bottom, and the
      // hero's copy is a top-anchored column — its eyebrow and heading would
      // sit on the bare picture. Opaque down through the copy, clear below it.
      if (section.overlay !== 'none') {
        out.push(
          '--sec-scrim-img:linear-gradient(to bottom, color-mix(in srgb, var(--color-background) calc(var(--sec-scrim,85) * 1%), transparent), color-mix(in srgb, var(--color-background) calc(var(--sec-scrim,85) * 1%), transparent) 80%, transparent)',
        );
      }
    }
  }

  return out.join(';');
}
