/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Espresso (warm cream + crimson + brass) — from the Claude design files.
        // Token names kept the same as before so every existing page flips automatically.
        bg: '#FBF6EC',          // parchment — page background
        card: '#FFFFFF',        // paper — cards / surfaces
        bg2: '#F5EFE2',         // cream — secondary surface
        border: '#E8DFD0',      // hairline borders
        line2: '#D9CCB8',       // stronger borders
        muted: '#8A7560',       // secondary text
        body: '#3D2817',        // body text (ink2)
        ink: '#1A0F08',         // primary text — espresso
        'gold-light': '#8B2E1F',// headings — crimson on cream
        gold: '#8B2E1F',        // primary accent — crimson
        accent: '#D9A441',      // brass — secondary accent / hover glow
        agent: '#7C3AED',       // Alfred / brain accent (kept)
        amharic: '#3F5D3F',     // forest — Amharic-language labels
        success: '#5A7A3F',
        warning: '#D9A441',
        danger: '#B23A1F',
        chip: '#EFE6D5',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
        amharic: ['Noto Serif Ethiopic', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(26, 15, 8, 0.04), 0 1px 3px rgba(26, 15, 8, 0.02)',
        editorial: '0 1px 3px rgba(26, 15, 8, 0.08), 0 4px 16px rgba(26, 15, 8, 0.06)',
      },
    },
  },
  plugins: [],
};
