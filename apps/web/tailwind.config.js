/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#fff5f5',
          100: '#ffe4e4',
          200: '#fecaca',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
      },
      boxShadow: {
        soft: '0 10px 30px rgba(20, 24, 31, 0.08)',
        card: '0 1px 2px rgba(20, 24, 31, 0.04)',
      },
    },
  },
  plugins: [],
};
