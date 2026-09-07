import animate from 'tailwindcss-animate'

/**
 * Tailwind config for coord web's design-token layer (#1546).
 *
 * Colour values are plain CSS custom properties (hex / rgba), NOT the
 * `hsl(var(--x))` triplets shadcn/ui's default template uses -- the token
 * seed this builds on (docs/mocks/web/_tokens.css) is authored in hex, and
 * re-deriving HSL triplets from it would be one more place for the real
 * theme to drift from the settled mocks. `var(--x)` works as a Tailwind
 * colour value exactly like `hsl(var(--x))` does; only the storage format
 * differs.
 *
 * Two colour vocabularies coexist deliberately:
 *  - the shadcn semantic slots (background/foreground/card/primary/...)
 *    that ui/* primitives and existing components (PipelineCard,
 *    ConnectionBadge, MobileKeyBar) already consume, so migrating the token
 *    values underneath them is a one-file change;
 *  - the raw mock palette (ground/surface/line/brand/pass/attn/fail/idle/
 *    faint) exposed under its own names for new primitives and the gallery,
 *    matching docs/mocks/web/_tokens.css exactly.
 *
 * `accent` is kept pointed at the neutral hover/press surface (its existing
 * meaning -- see MobileKeyBar's `active:bg-accent`) rather than repointed at
 * the mock's cyan "work is happening" colour, which would have silently
 * recoloured every existing pressed-state highlight. The cyan lives under
 * `brand` instead (`--accent` the CSS custom property, to match the mock's
 * own naming) and drives `ring`/`primary`, matching the mocks' focus and
 * primary-button treatment.
 */
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
    },
    extend: {
      colors: {
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent-surface)',
          foreground: 'var(--accent-surface-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },

        // ── raw mock palette (docs/mocks/web/_tokens.css) ────────────────
        ground: 'var(--ground)',
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        faint: 'var(--text-faint)',
        brand: {
          DEFAULT: 'var(--accent)',
          dim: 'var(--accent-dim)',
          wash: 'var(--accent-wash)',
        },
        pass: {
          DEFAULT: 'var(--pass)',
          wash: 'var(--pass-wash)',
        },
        attn: {
          DEFAULT: 'var(--attn)',
          wash: 'var(--attn-wash)',
        },
        fail: {
          DEFAULT: 'var(--fail)',
          wash: 'var(--fail-wash)',
        },
        idle: {
          DEFAULT: 'var(--idle)',
          wash: 'var(--idle-wash)',
        },
      },
      fontFamily: {
        sans: ['var(--font-ui)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        /* #102: the codebase's ~280 `text-sm`/`text-xs`/`text-base` call
         * sites outnumber the dozen `text-step-*` ones by more than 20:1 —
         * scaling only the step-* utilities would leave nearly all of the
         * app's actual body text at its old (too-small) size. Pointing
         * Tailwind's own defaults at the same --step-* custom properties
         * (src/index.css) keeps a single source of truth and moves both
         * vocabularies together. `lg` has no ramp slot (the ramp skips from
         * step-1/16px to step-2/20px) so it keeps its own value, scaled by
         * the same ~1.25x and rounded to a whole pixel (18px -> 22px).
         */
        xs: 'var(--step--1)',
        sm: 'var(--step-0)',
        base: 'var(--step-1)',
        lg: '1.375rem' /* 22px, was 18px */,
        xl: 'var(--step-2)',
        '2xl': 'var(--step-3)',
        'step--1': 'var(--step--1)',
        'step-0': 'var(--step-0)',
        'step-1': 'var(--step-1)',
        'step-2': 'var(--step-2)',
        'step-3': 'var(--step-3)',
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
      },
      boxShadow: {
        elevation: '0 18px 44px -12px rgba(0,0,0,.66)',
      },
      keyframes: {
        'pulse-ring': {
          '0%, 100%': { opacity: 1, boxShadow: '0 0 0 0 var(--accent-wash)' },
          '50%': { opacity: 0.55, boxShadow: '0 0 0 6px transparent' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 2s ease-in-out infinite',
      },
    },
  },
  plugins: [animate],
}
