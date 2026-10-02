import { sequence } from 'astro:middleware';

import { initContext, hydratePage } from './route';
import { bodyLimit } from './body-limit';
import { editMode } from './edit-mode';
import { editor } from './editor';
import { htmlCache } from './html-cache';
import { resolveCopy } from './resolve-copy';
import { cart } from './cart';
import { localization } from './localization';
import { account } from './account';
import { checkout } from './checkout';

// initContext first — everything reads `locals.swell`. bodyLimit before
// anything can read a body. editMode next: the cache must see the edit
// decision. editor gates /editor before anything renders or caches for it.
// The cache comes before any hydration so a hit does no API work. resolveCopy
// builds `locals.t` and must follow hydratePage: the SDK only knows the locale
// and currency once the settings are loaded. cart before checkout, which
// forwards to `locals.cart.checkout_url`; localization answers its own post
// and passes everything else on.
export const onRequest = sequence(
  initContext,
  bodyLimit,
  editMode,
  editor,
  htmlCache,
  hydratePage,
  resolveCopy,
  cart,
  localization,
  account,
  checkout,
);
