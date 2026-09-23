import type { APIContext, MiddlewareHandler } from 'astro';
import type { SwellData } from '@swell/apps-sdk';

import { jsonResponse, serializeCart } from '@/lib/cart-json';
import { toCartOptions } from '@/lib/product-options';

// The only pages rendered from the cart itself. Everywhere else the cart is
// per-visitor state that would poison the shared page cache, so it is left off
// the server render and fetched client-side from /cart.json.
const CART_PAGES = /^\/(?:cart|checkout)(?:\/|$)/;

/**
 * Handles the add/update/remove posts to `/cart`, and hydrates `locals.cart`
 * for the cart and checkout pages only.
 *
 * A form post answers with a redirect (post-redirect-get, so a reload never
 * re-submits). The same post with `Accept: application/json` — the drawer —
 * answers with the updated cart instead, so it needs no second round trip.
 */
export const cart: MiddlewareHandler = async (context, next) => {
  if (context.request.method === 'POST' && context.url.pathname === '/cart') {
    return handleCartAction(context);
  }

  if (CART_PAGES.test(context.url.pathname)) {
    context.locals.cart = await context.locals.swell.storefront.cart
      .get()
      .catch(() => null);
  }

  return next();
};

async function handleCartAction(context: APIContext): Promise<Response> {
  const storefront = context.locals.swell.storefront;
  const wantsJson = context.request.headers
    .get('accept')
    ?.includes('application/json');

  const form = await context.request.formData();
  const action = string(form.get('action')) || 'add';
  const itemId = string(form.get('item_id'));
  const quantity = Number(form.get('quantity'));

  let failure: string | null = null;
  let result: unknown;

  try {
    // swell-js resolves with `{ errors }` rather than throwing on a rejected
    // write, so the result is checked as well as the promise.
    switch (action) {
      case 'add': {
        // No variant_id: the API resolves the variant from the variant
        // options' values, and when both are sent it is the options that
        // win anyway. Sending one combination id would also lose every
        // non-variant option the shopper answered.
        const options = toCartOptions(form);

        result = await storefront.cart.addItem({
          product_id: string(form.get('product_id')),
          options: options.length > 0 ? options : undefined,
          quantity: quantity > 0 ? quantity : 1,
        });
        break;
      }

      case 'update':
        // A quantity of zero from a cart line input means remove.
        result =
          quantity > 0
            ? await storefront.cart.updateItem(itemId, { quantity })
            : await storefront.cart.removeItem(itemId);
        break;

      case 'remove':
        result = await storefront.cart.removeItem(itemId);
        break;

      // Every write re-validates every line, so one line the catalog no
      // longer accepts — an option since deleted, a variant since regenerated
      // — refuses the removal of any other, and the cart cannot be emptied a
      // line at a time. Clearing it outright has nothing left to validate.
      case 'empty':
        result = await storefront.cart.setItems([]);
        break;

      default:
        failure = 'Unknown cart action.';
    }

    failure ??= errorMessage(result, context.locals.t('global_drawer_add_rejected'));
  } catch (err) {
    console.error('Cart action failed', err);
    failure = context.locals.t('global_drawer_add_failed');
  }

  if (wantsJson) {
    // swell-js answers a successful write with the updated cart, so the drawer
    // gets it from that response rather than paying for a second round trip.
    // Only a failed or unrecognised result is followed by a fresh read.
    const cart = isCart(result)
      ? result
      : await storefront.cart.get().catch(() => null);

    return jsonResponse(
      { cart: serializeCart(cart), error: failure },
      failure ? 422 : 200,
    );
  }

  // A rejected write used to redirect exactly like a successful one, which
  // was survivable when the only thing a form could post was a variant the
  // merchant had already created. Options can be refused — no variant matches
  // the chosen values, a value has gone away — so the page is told.
  const path = returnPath(form.get('redirect_to'));

  return context.redirect(
    failure ? `${path}${path.includes('?') ? '&' : '?'}cart_error=1` : path,
    303,
  );
}

function isCart(value: unknown): value is SwellData {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as SwellData).items) &&
    !(value as SwellData).errors
  );
}

function errorMessage(result: unknown, fallback: string): string | null {
  const errors = (result as { errors?: Record<string, { message?: string }> })
    ?.errors;

  if (!errors || typeof errors !== 'object') {
    return null;
  }

  const first = Object.values(errors)[0];
  return first?.message || fallback;
}

function string(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Only same-site paths, so a crafted form cannot bounce shoppers off-site.
 * Resolving against a fixed origin is the real check: browsers parse
 * `/\evil.com` and `/%5cevil.com` as an authority, and so does the URL parser
 * here, which then fails the origin comparison. Anything else goes to
 * `fallback`.
 */
export function returnPath(
  value: FormDataEntryValue | null,
  fallback = '/cart',
): string {
  const path = string(value);

  if (!/^\/(?![/\\])/.test(path)) {
    return fallback;
  }

  try {
    const base = 'https://same-site.invalid';
    const url = new URL(path, base);

    return url.origin === base ? `${url.pathname}${url.search}` : fallback;
  } catch {
    return fallback;
  }
}
