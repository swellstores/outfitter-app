/**
 * Sizes for an image the browser can choose between.
 *
 * Swell's CDN resizes on request with `?width=`, so a picture stored there can
 * be fetched at the size it is shown rather than the size it was uploaded.
 * Other hosts — Printful's, for one — serve a single size, and get no srcset:
 * listing widths they ignore would only change the cache key.
 */

const RESIZABLE = /^https:\/\/cdn\.swell\.store\//;

/** Product pictures: Printful mockups are 800px, merchant photos larger. */
export const PRODUCT_WIDTHS = [320, 480, 640, 800, 1200];

/** Section pictures, which can run the width of the page. */
export const WIDE_WIDTHS = [640, 960, 1400, 2100];

/** Thumbnails in the cart. */
export const THUMB_WIDTHS = [120, 240];

export function srcset(url: string | undefined, widths: number[]): string | undefined {
  if (!url || !RESIZABLE.test(url)) {
    return undefined;
  }

  const join = url.includes('?') ? '&' : '?';

  return widths.map((width) => `${url}${join}width=${width} ${width}w`).join(', ');
}

/** A grid card: half the page under 1024px, a quarter above, at most ~330px. */
export const CARD_SIZES = '(min-width: 1400px) 330px, (min-width: 1024px) 24vw, 48vw';
