import type { MiddlewareHandler } from 'astro';

import { tenantKey } from '@/swell';
import { getAppSettings } from '@/lib/app-settings';
import { resolveContent } from '@/lib/content';
import { isPageRequest } from './route';

/**
 * Builds `locals.t` — the resolver every page, component and the layout read
 * their copy through — for the storefront's current locale. That is the one
 * the shopper (or the merchant, in the editor) chose in the header; there is
 * no other.
 *
 * Sits after `hydratePage` on purpose. The SDK reports the storefront's locale
 * and currency from the settings it has loaded; asked before `/settings/all`
 * has resolved it answers a hardcoded en-US and, worse, keeps the pending
 * settings promise as the request's currency, which then renders as
 * "[object Promise]" in every price. So nothing here touches localization
 * until the settings are in.
 */
export const resolveCopy: MiddlewareHandler = async (context, next) => {
  const { swell } = context.locals;

  // Assets and the JSON routes never render copy, so they get the defaults
  // without a settings read — and without asking the SDK for a locale.
  if (!isPageRequest(context)) {
    context.locals.editLocale = '';
    context.locals.t = resolveContent(undefined, '');

    return next();
  }

  // hydratePage skips non-GET requests; the cart posts still read copy for
  // their error messages, so the settings are loaded for them here.
  if (context.request.method !== 'GET') {
    await swell.getStorefrontSettings().catch(() => undefined);
  }

  const { locale } = swell.getStorefrontLocalization();

  context.locals.editLocale = locale;
  context.locals.t = resolveContent(
    await getAppSettings(swell, tenantKey(context)),
    locale,
  );

  return next();
};
