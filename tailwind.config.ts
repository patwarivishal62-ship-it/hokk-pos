import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f7f7f6',
          100: '#eeeeec',
          200: '#dedcd8',
          300: '#c4c1ba',
          400: '#9b978e',
          500: '#7a766d',
          600: '#5e5b54',
          700: '#46443f',
          800: '#2b2a27',
          900: '#171716',
          950: '#0d0d0c',
        },
        brand: {
          DEFAULT: '#7a1f2b',
          dark: '#5c1520',
          light: '#a83a48',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', '14px'],
      },
    },
  },
  plugins: [],
};

export default config;
