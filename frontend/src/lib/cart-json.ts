import type { SwellData } from '@swell/apps-sdk';

/**
 * The cart as the client sees it. The storefront cart carries far more than the
 * drawer or header need, and some of it (account, billing) is nobody's business
 * in a JSON response, so only what renders is sent.
 */
export interface CartJson {
  id: string | null;
  item_quantity: number;
  sub_total: number;
  discount_total: number;
  grand_total: number;
  currency: string | null;
  checkout_url: string | null;
  items: CartLineJson[];
}

export interface CartLineJson {
  id: string;
  product_id: string | null;
  name: string;
  slug: string | null;
  image: string | null;
  options: string;
  price: number;
  price_total: number;
  quantity: number;
}

export function serializeCart(cart: SwellData | null | undefined): CartJson {
  const items: SwellData[] = cart?.items ?? [];

  return {
    id: cart?.id ?? null,
    item_quantity: Number(cart?.item_quantity) || 0,
    sub_total: Number(cart?.sub_total) || 0,
    discount_total: Number(cart?.discount_total) || 0,
    grand_total: Number(cart?.grand_total) || 0,
    currency: cart?.currency ?? null,
    checkout_url: cart?.checkout_url ?? null,
    items: items.map((item) => ({
      id: String(item.id),
      product_id: item.product_id ?? null,
      name: item.product_name || item.product?.name || '',
      slug: item.product?.slug ?? null,
      image: item.product?.images?.[0]?.file?.url ?? null,
      options: optionsOf(item),
      price: Number(item.price) || 0,
      price_total: Number(item.price_total) || 0,
      quantity: Number(item.quantity) || 0,
    })),
  };
}

/**
 * What the shopper chose, as one line. A variant option is its value alone —
 * "Large" needs no label — but anything else is named, because "Eric" on its
 * own in a cart line says nothing about what it is.
 */
export function optionsOf(item: SwellData): string {
  const options: SwellData[] = item.options ?? [];

  const parts = options
    .filter((option) => option?.value)
    .map((option) =>
      option.variant || !option.name
        ? String(option.value)
        : `${option.name}: ${option.value}`,
    );

  return parts.length > 0 ? parts.join(' · ') : item.variant?.name || '';
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Per-visitor, so it must never land in any cache, edge or browser.
      'cache-control': 'no-store, private',
    },
  });
}
