import { EN } from './i18n-en';

/**
 * Guest screens speak Indonesian, or English for a guest who asks (tourists, international
 * events). The Indonesian text is the key: a string with no English entry shows as written, so a
 * missing translation never breaks a screen. The operator console stays Indonesian.
 */
export type Lang = 'id' | 'en';

/** The language the guest at the booth chose; the booth goes back to Indonesian for the next one. */
export const LANG_COOKIE = 'booth_lang';

export function langOf(value: string | null | undefined): Lang {
  return value === 'en' ? 'en' : 'id';
}

export type Vars = Record<string, string | number>;

/**
 * `text` in `lang`, with `{name}` placeholders filled from `vars`. An English entry may give
 * "one|many" forms, picked by `vars.n` ("1 sheet", "2 sheets"); Indonesian needs none.
 */
export function translate(lang: Lang, text: string, vars?: Vars): string {
  let base = lang === 'en' ? (EN[text] ?? text) : text;
  if (base.includes('|') && vars && 'n' in vars) base = base.split('|')[Number(vars.n) === 1 ? 0 : 1];
  return vars ? base.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match)) : base;
}

/** Dates as the guest reads them. */
export function dateLocale(lang: Lang): string {
  return lang === 'en' ? 'en-GB' : 'id-ID';
}
