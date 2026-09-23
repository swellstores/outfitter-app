import type { MiddlewareHandler } from 'astro';

/**
 * Guards `/checkout`. The page there is a handoff: it reviews the cart, lists
 * the shipping services the cart was rated with, whichever carriers and apps
 * produced them, and links out to Swell's hosted checkout. Payment is never
 * collected here.
 *
 * An empty cart has nothing to review, so it goes back to `/cart` rather than
 * rendering an empty handoff.
 */
export const checkout: MiddlewareHandler = (context, next) => {
  if (context.request.method !== 'GET' || context.url.pathname !== '/checkout') {
    return next();
  }

  // In the editor the merchant's cart is always empty — shopping is switched
  // off there — so the page renders anyway, with its empty states, for the
  // copy on it to be editable in place.
  if (!context.locals.cart?.items?.length && !context.locals.editMode) {
    return context.redirect('/cart', 303);
  }

  return next();
};
