import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Derived from the Mr. Outreach logo mark (logo/mr-logo.png).
        brand: {
          50: '#F6F0FB',
          100: '#ECDFF7',
          200: '#D8B8E8',
          300: '#C299DE',
          400: '#A66AD1',
          500: '#8B3FC9',
          600: '#722FA8',
          700: '#582068',
          800: '#431A4E',
          900: '#2E1236',
        },
        accent: {
          50: '#FFF7EB',
          100: '#FEE9C7',
          200: '#FDD48F',
          300: '#FBBA57',
          400: '#F8A62E',
          500: '#F5991C',
          600: '#D97F0D',
          700: '#B4650A',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
