import type { SwellData } from '@swell/apps-sdk';

export interface LocalizationOption {
  code: string;
  /** The display name from store settings, or the code when there is none. */
  name: string;
}

/**
 * The store's locales or currencies as the header offers them: the base one
 * first, then the configured list from `settings.state.store`, each code
 * once. The list holds `{ code, name, … }` records; anything else is skipped,
 * so a store with nothing configured yields just its base.
 */
export function localizationOptions(
  base: unknown,
  list: unknown,
): LocalizationOption[] {
  const names = new Map<string, string>();

  if (typeof base === 'string' && base) {
    names.set(base, base);
  }

  for (const item of Array.isArray(list) ? list : []) {
    const record = item as SwellData | null;
    const code = record?.code;

    if (typeof code === 'string' && code) {
      names.set(
        code,
        typeof record?.name === 'string' && record.name ? record.name : code,
      );
    }
  }

  return [...names].map(([code, name]) => ({ code, name }));
}
