import type { Config } from 'tailwindcss'

// Design system tokens — COMPACT variant: smaller type scale + tight spacing.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#1B4DFF', 600: '#1540DB', 50: '#F1F4FF' },
        ink: '#111827',
        muted: '#6B7280',
        line: '#EEF0F4',
        success: '#16A34A',
        warning: '#D97706',
        danger: '#DC2626',
        surface: '#F5F7FF',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      // Smaller type scale (px) — text-base is 13px, everything else scaled down.
      fontSize: {
        '2xs': ['10px', '14px'],
        xs: ['11px', '15px'],
        sm: ['12px', '16px'],
        base: ['13px', '18px'],
        lg: ['15px', '20px'],
        xl: ['17px', '23px'],
        '2xl': ['20px', '26px'],
      },
      borderRadius: { lg: '0.5rem', xl: '0.625rem' },
      boxShadow: { card: '0 1px 2px rgba(17,24,39,0.05)', lift: '0 8px 24px rgba(17,24,39,0.12)' },
      transitionDuration: { DEFAULT: '180ms' },
    },
  },
  plugins: [],
}
export default config
