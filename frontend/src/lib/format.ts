// Money and date formatting. `Intl` is available in the Workers runtime, so
// nothing is pulled in for this.

const FALLBACK_LOCALE = 'en-US';
const FALLBACK_CURRENCY = 'USD';

/**
 * Formats an amount in the store's currency. Missing amounts format as zero
 * rather than blanking a price, and an unrecognised currency or locale falls
 * back to a plain "12.00 USD" instead of throwing mid-render.
 */
export function formatMoney(
  amount: unknown,
  currency = FALLBACK_CURRENCY,
  locale = FALLBACK_LOCALE,
): string {
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(safe);
  } catch {
    return `${safe.toFixed(2)} ${currency}`;
  }
}

/** Formats an API date string. Returns '' for anything unparseable. */
export function formatDate(value: unknown, locale = FALLBACK_LOCALE): string {
  if (!value || (typeof value !== 'string' && !(value instanceof Date))) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * HTML to one line of plain text, cut at a word to at most `max` characters —
 * a rich description turned into a meta description.
 */
export function plainText(html: unknown, max = 160): string {
  if (typeof html !== 'string') {
    return '';
  }

  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= max) {
    return text;
  }

  const cut = text.slice(0, max - 1);

  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : cut.length)}…`;
}
