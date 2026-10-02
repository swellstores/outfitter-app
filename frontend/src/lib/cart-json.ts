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
      image: lineImage(item),
      options: optionsOf(item),
      price: Number(item.price) || 0,
      price_total: Number(item.price_total) || 0,
      quantity: Number(item.quantity) || 0,
    })),
  };
}

/**
 * What the shopper chose, as one line. A variant option is its value alone —
 * "Large" needs no label — and a ticked toggle is its option's name alone,
 * since its value only restates the checkbox. Anything else is named, because
 * "Eric" on its own in a cart line says nothing about what it is.
 */
export function optionsOf(item: SwellData): string {
  const options: SwellData[] = item.options ?? [];

  const parts = options
    .filter((option) => option?.value)
    .map((option) => {
      if (option.variant || !option.name) {
        return String(option.value);
      }

      return isToggle(productOption(item, option.id))
        ? String(option.name)
        : `${option.name}: ${option.value}`;
    });

  return parts.length > 0 ? parts.join(' · ') : item.variant?.name || '';
}

/**
 * The line's picture: the chosen colourway's, when an option value carries
 * one — the same photo the product page swapped to — else the product's own.
 */
export function lineImage(item: SwellData): string | null {
  for (const option of (item.options ?? []) as SwellData[]) {
    const value = (productOption(item, option?.id)?.values ?? []).find(
      (candidate: SwellData) => candidate?.id === option?.value_id,
    );

    if (typeof value?.image?.url === 'string' && value.image.url) {
      return value.image.url;
    }
  }

  return item.product?.images?.[0]?.file?.url ?? null;
}

function productOption(item: SwellData, id: unknown): SwellData | undefined {
  return (item.product?.options ?? []).find(
    (option: SwellData) => option?.id === id,
  );
}

function isToggle(option: SwellData | undefined): boolean {
  return option?.input_type === 'toggle' || option?.input_type === 'checkbox';
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
