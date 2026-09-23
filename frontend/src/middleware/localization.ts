import type { MiddlewareHandler } from 'astro';

import { localizationOptions } from '@/lib/localization';
import { returnPath } from './cart';

/**
 * Handles the header's language and currency control: `POST /localization`
 * with `locale` and/or `currency`, answered with a redirect to `redirect_to`.
 *
 * A post to a path of its own, on purpose. The SDK writes the `swell-locale`
 * and `swell-currency` cookies through `setCookie` in src/swell.ts, which
 * withholds them on any render the page cache could share between visitors.
 * A post is never cached, so here the cookies land — and the page it goes
 * back to is then served under the cache key for that locale and currency.
 *
 * Only codes the store is configured for are taken; anything else is left as
 * it was rather than refused, and the shopper lands back where they were.
 * `redirect_to` carries the page's own query string, `__edit` included, so a
 * merchant switching language in the editor stays in edit mode.
 */
export const localization: MiddlewareHandler = async (context, next) => {
  if (
    context.request.method !== 'POST' ||
    context.url.pathname !== '/localization'
  ) {
    return next();
  }

  const { swell } = context.locals;
  const form = await context.request.formData();
  const settings = await swell.getStorefrontSettings().catch(() => undefined);
  const store = settings?.state?.store;

  const locale = form.get('locale');
  const currency = form.get('currency');

  try {
    if (
      typeof locale === 'string' &&
      localizationOptions(store?.locale, store?.locales).some(
        (option) => option.code === locale,
      )
    ) {
      await swell.storefront.locale.select(locale);
    }

    if (
      typeof currency === 'string' &&
      localizationOptions(store?.currency, store?.currencies).some(
        (option) => option.code === currency,
      )
    ) {
      await swell.storefront.currency.select(currency);
    }
  } catch (err) {
    // The cookie is written before the session call that can fail, so the
    // choice still takes; the redirect below shows it.
    console.error('Localization change failed', err);
  }

  return context.redirect(returnPath(form.get('redirect_to'), '/'), 303);
};
