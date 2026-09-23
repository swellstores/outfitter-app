import type { MiddlewareHandler } from 'astro';

// Pages under /account that a logged-out shopper is allowed to reach.
const PUBLIC_PATHS = new Set([
  '/account/login',
  '/account/signup',
  '/account/recover',
]);

/**
 * Gates `/account`: logs out, hydrates `locals.account`, and sends anonymous
 * visitors to the login page. Pages outside `/account` are untouched — read
 * `locals.swell.storefront.account.get()` directly if one of them needs it.
 */
export const account: MiddlewareHandler = async (context, next) => {
  const { pathname } = context.url;

  if (!pathname.startsWith('/account')) {
    return next();
  }

  const storefront = context.locals.swell.storefront;

  if (pathname === '/account/logout') {
    await storefront.account.logout().catch(() => undefined);

    return context.redirect('/', 303);
  }

  context.locals.account = await storefront.account.get().catch(() => null);

  // The editor is not signed in as a customer and never will be; the account
  // pages render for it with no account, showing their fallback copy.
  if (
    !context.locals.account &&
    !PUBLIC_PATHS.has(pathname) &&
    !context.locals.editMode
  ) {
    return context.redirect('/account/login', 303);
  }

  return next();
};
