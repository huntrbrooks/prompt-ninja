/**
 * tailwind.config.js — PromptPlus Unified Theme
 * Harmonizes ChatGPT (teal), Codex (indigo), and Claude (beige) aesthetics.
 *
 * Usage: reference extended colours via `bg-primary`, `text-secondary`, etc.
 * CSS variables are defined in styles.css / theme.css for runtime switching.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./renderer/**/*.{html,js}'],
  darkMode: 'class', // toggle via <html class="dark">

  theme: {
    extend: {
      /* ── Colour palette (backed by CSS variables for runtime switching) ── */
      colors: {
        /* Backgrounds */
        'bg-light':       'var(--color-bg-light)',       // #F8F9FA
        'bg-light-alt':   'var(--color-bg-light-alt)',   // #F0F1F5  (sidebar)
        'bg-light-panel': 'var(--color-bg-light-panel)', // #E9EBEF  (panels)
        'bg-dark':        'var(--color-bg-dark)',         // #0E1116
        'bg-dark-alt':    'var(--color-bg-dark-alt)',     // #131621
        'bg-dark-panel':  'var(--color-bg-dark-panel)',   // #1A1E27

        /* Accent: Primary (ChatGPT teal/green) */
        primary:          'var(--color-accent-primary)',  // #10A37F
        'primary-hover':  'var(--color-accent-primary-hover)', // #0D8C6D
        'primary-light':  'var(--color-accent-primary-light)', // #E6F7F2

        /* Accent: Secondary (Codex purple/indigo) */
        secondary:          'var(--color-accent-secondary)',       // #6B5FC5
        'secondary-hover':  'var(--color-accent-secondary-hover)', // #574DB0
        'secondary-light':  'var(--color-accent-secondary-light)', // #EEEAFF

        /* Accent: Beige (Claude warm highlight) */
        beige:       'var(--color-beige)',       // #FCEBD9
        'beige-dark':'var(--color-beige-dark)',   // #F5D5B0

        /* Text */
        'text-dark':  'var(--color-text-dark)',   // #202124  (on light bg)
        'text-muted': 'var(--color-text-muted)',  // #6B7280
        'text-light': 'var(--color-text-light)',  // #F5F7FA  (on dark bg)
        'text-light-muted': 'var(--color-text-light-muted)', // #9CA3AF

        /* Borders */
        'border-light': 'var(--color-border-light)', // #D0D7E2
        'border-dark':  'var(--color-border-dark)',   // #2A2E37

        /* Semantic */
        success: 'var(--color-success)',  // #10A37F
        error:   'var(--color-error)',    // #EF4444
        warning: 'var(--color-warning)',  // #F59E0B
        info:    'var(--color-info)',     // #6B5FC5
      },

      /* ── Font family ── */
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', 'Roboto', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },

      /* ── Font size (design-system scale) ── */
      fontSize: {
        'body': ['14px', { lineHeight: '1.5' }],
        'sm':   ['13px', { lineHeight: '1.5' }],
        'xs':   ['11px', { lineHeight: '1.4' }],
        'h1':   ['24px', { lineHeight: '1.3', fontWeight: '600' }],
        'h2':   ['20px', { lineHeight: '1.35', fontWeight: '600' }],
        'h3':   ['18px', { lineHeight: '1.4', fontWeight: '600' }],
      },

      /* ── Border radius ── */
      borderRadius: {
        'btn': '6px',
        'card': '8px',
        'modal': '12px',
        'input': '6px',
      },

      /* ── Box shadow ── */
      boxShadow: {
        'card-light': '0 1px 3px rgba(0,0,0,0.1)',
        'card-dark':  '0 1px 3px rgba(0,0,0,0.5)',
        'modal':      '0 24px 80px rgba(0,0,0,0.25)',
        'modal-dark': '0 24px 80px rgba(0,0,0,0.7)',
        'focus':      '0 0 0 2px var(--color-accent-primary)',
      },

      /* ── Spacing (8px base grid) ── */
      spacing: {
        '4.5': '18px',
        '7':   '28px',
        '13':  '52px',
        '18':  '72px',
      },

      /* ── Transition ── */
      transitionDuration: {
        '150': '150ms',
        '200': '200ms',
      },
    },
  },

  plugins: [],
};
