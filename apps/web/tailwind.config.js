/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Espresso (warm cream + crimson + brass) — from the Claude design files.
        // Token names kept the same as before so every existing page flips automatically.
        bg: '#FAF9F5',          // soft warm background
        card: '#FFFFFF',        // paper — cards / surfaces
        bg2: '#F0F5F2',         // subtle green cream
        border: '#E0EAE5',      // hairline borders
        line2: '#CFDCD6',       // stronger borders
        muted: '#5B7065',       // secondary text
        body: '#16332B',        // body text (emerald dark)
        ink: '#0A1E18',         // primary text — deep forest emerald
        'gold-light': '#D4AF37',// headings — radiant gold
        gold: '#C5A059',        // primary accent — lustrous gold
        accent: '#D4AF37',      // gold accent
        agent: '#10B981',       // emerald green
        amharic: '#1B5E43',     // forest green
        success: '#10B981',     // emerald green success
        warning: '#D4AF37',     // golden warning
        danger: '#B23A1F',
        chip: '#E6F2EC',        // soft emerald chip
        // Telegram Mini App Luxury Design Tokens
        'tma-gold': '#C9A86A',
        'tma-green': '#59D18C',
        'tma-red': '#FF7272',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Cormorant Garamond', 'Georgia', 'serif'],
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
