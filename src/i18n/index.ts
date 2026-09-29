import { en, type Catalog, type MessageKey } from "./en";

export type { MessageKey } from "./en";

/** Languages the app can be switched to. Adding one = adding a catalog with every key of `en` and listing it here. */
export const CATALOGS: Record<string, Catalog> = { en };
export const DEFAULT_LOCALE = "en";

/**
 * Looks up a message and fills `{placeholders}`. Unknown locales fall back to English, and a missing key
 * returns the key itself so a gap is visible rather than blank.
 */
export function t(key: MessageKey, params?: Record<string, string | number>, locale: string = DEFAULT_LOCALE): string {
  const catalog = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
  const template = catalog[key] ?? CATALOGS[DEFAULT_LOCALE][key] ?? key;
  return params ? template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : template;
}
