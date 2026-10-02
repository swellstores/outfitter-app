import type { APIRoute } from 'astro';
import type { SwellData } from '@swell/apps-sdk';

import { tenantKey } from '@/swell';
import { jsonResponse } from '@/lib/cart-json';
import { CONTENT_FIELDS, CONTENT_PAGES } from '@/lib/content';
import {
  CONTENT_PANEL,
  SECTIONS_PANEL,
  SETTINGS_FIELDS,
  SETTINGS_PANEL,
  getStorefrontId,
  isEditorRequest,
  isRecord,
  readSettingsValues,
  type EditorPage,
  type EditorState,
} from '@/lib/editor';
import { SECTION_PAGES, SECTION_TYPES, pageSections } from '@/lib/sections';
import { getStoreLocales } from '@/lib/store-locales';

/**
 * Everything the editor shell needs to open: the store's default locale, the
 * pages it can show, the saved copy, settings and home page sections, and
 * the fields each is made of.
 *
 * The settings document is read directly rather than through the memoised
 * app settings: the merchant opening the editor wants what is saved now.
 */
export const GET: APIRoute = async (context) => {
  const { swell } = context.locals;

  const tenant = tenantKey(context);
  const storefrontId = getStorefrontId(context);
  const warnings: string[] = [];

  // The gate's own check runs alongside the reads rather than ahead of
  // them. Nothing read here is returned unless it passes, and every read is
  // the app's own data, so starting them early leaks nothing.
  const [allowed, store, values, products, categories] = await Promise.all([
    isEditorRequest(context),
    getStoreLocales(swell, tenant),
    readSettingsValues(swell, storefrontId).catch((err: unknown) => {
      console.error('Editor state read failed', err);
      warnings.push('Saved settings could not be read — reopen the editor to try again.');
      return {} as Record<string, unknown>;
    }),
    swell.storefront.products.list({ limit: 1 }).catch(() => null),
    swell.storefront.categories.list({ limit: 1 }).catch(() => null),
  ]);

  if (!allowed) {
    return jsonResponse({ error: 'not_found' }, 404);
  }

  // Without the store's default locale, copy saves are refused: by the
  // content route, and for the whole session by the shell, which cannot tell
  // where default copy is stored when `defaultLocale` is empty. The merchant
  // hears why before making one.
  if (!store) {
    warnings.push('The store’s languages could not be read — reopen the editor before editing copy.');
  }

  const product: SwellData | undefined = products?.results?.[0];
  const category: SwellData | undefined = categories?.results?.[0];

  const pages: EditorPage[] = [
    { id: 'home', label: 'Home', url: '/', group: 'home' },
    product && {
      id: 'product',
      label: 'Product',
      url: `/products/${product.slug || product.id}`,
      group: 'product',
    },
    category && {
      id: 'category',
      label: 'Category',
      url: `/categories/${category.slug || category.id}`,
      group: 'category',
    },
    { id: 'cart', label: 'Cart', url: '/cart', group: 'cart' },
    { id: 'checkout', label: 'Checkout', url: '/checkout', group: 'checkout' },
    { id: 'login', label: 'Sign in', url: '/account/login', group: 'account' },
    { id: 'signup', label: 'Sign up', url: '/account/signup', group: 'account' },
    {
      id: 'recover',
      label: 'Recover password',
      url: '/account/recover',
      group: 'account',
    },
    { id: 'account', label: 'Account', url: '/account', group: 'account' },
    { id: 'orders', label: 'Orders', url: '/account/orders', group: 'account' },
    // Paths that match no product, category or route, so each not-found state
    // has a page to be edited on. None starts with `/_`, which the router
    // treats as an asset and would render without the store's copy.
    {
      id: 'product-not-found',
      label: 'Product not found',
      url: '/products/editor-not-found',
      group: 'product',
    },
    {
      id: 'category-not-found',
      label: 'Category not found',
      url: '/categories/editor-not-found',
      group: 'category',
    },
    {
      id: 'not-found',
      label: 'Not found',
      url: '/editor/not-found',
      group: 'not-found',
    },
  ].filter((page): page is EditorPage => Boolean(page));

  const state: EditorState = {
    storefrontId,
    defaultLocale: store?.locale ?? '',
    pages,
    content: {
      values: isRecord(values[CONTENT_PANEL]) ? values[CONTENT_PANEL] : {},
      fields: CONTENT_FIELDS,
      pages: CONTENT_PAGES,
    },
    settings: {
      values: isRecord(values[SETTINGS_PANEL]) ? values[SETTINGS_PANEL] : {},
      fields: SETTINGS_FIELDS,
    },
    sections: {
      lists: Object.fromEntries(
        SECTION_PAGES.map((page) => [
          page,
          pageSections(values[SECTIONS_PANEL], page, values[CONTENT_PANEL]),
        ]),
      ),
      types: SECTION_TYPES,
    },
    warnings,
  };

  return jsonResponse(state);
};
