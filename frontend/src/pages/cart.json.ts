import type { APIRoute } from 'astro';

import { jsonResponse, serializeCart } from '@/lib/cart-json';

/**
 * The current visitor's cart. Pages are cached and shared between visitors, so
 * the header count and the drawer read their state from here instead.
 */
export const GET: APIRoute = async (context) => {
  const cart = await context.locals.swell.storefront.cart
    .get()
    .catch(() => null);

  return jsonResponse({ cart: serializeCart(cart) });
};
