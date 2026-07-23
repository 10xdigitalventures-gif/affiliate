import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontSize: { '2xs': ['0.6875rem', { lineHeight: '1rem' }] },
      colors: {
        brand: { DEFAULT: '#1B4DFF', 600: '#1540DB', 700: '#1235B8', 50: '#F1F4FF', 100: '#E4EAFF' },
        ink: '#0B1220',
        muted: '#5B6472',
        line: '#E9ECF3',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      maxWidth: { '7xl': '80rem' },
      boxShadow: {
        card: '0 1px 3px rgba(11,18,32,0.06), 0 1px 2px rgba(11,18,32,0.04)',
        lift: '0 10px 30px -12px rgba(27,77,255,0.25)',
      },
      backgroundImage: {
        'grid-faint':
          'linear-gradient(to right, rgba(11,18,32,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(11,18,32,0.04) 1px, transparent 1px)',
      },
      keyframes: {
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
      },
      animation: { floaty: 'floaty 6s ease-in-out infinite' },
    },
  },
  plugins: [],
}
export default config
