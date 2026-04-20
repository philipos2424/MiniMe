/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0C0C0E',
        gold: '#D4A853',
        'gold-light': '#F5D799',
        card: '#13130f',
        border: '#1f1f18',
        muted: '#6a6252',
        body: '#c9c0a8',
        agent: '#7C3AED',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Playfair Display', 'serif'],
      },
    },
  },
  plugins: [],
};
