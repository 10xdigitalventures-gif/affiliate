/**
 * next-intl configuration.
 * Install: npm install next-intl
 */
export const locales = ['en', 'ar', 'fr'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'en'
export const rtlLocales: Locale[] = ['ar']

export function isRtl(locale: Locale): boolean {
  return rtlLocales.includes(locale)
}
