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
         *
         * Each entry pairs its size with an explicit `lineHeight` rather
         * than a bare string — a bare string drops Tailwind's default
         * per-size line-height and falls back to Preflight's flat
         * `html { line-height: 1.5 }`, which loosens small text (e.g.
         * `text-xs`) far more than the ~1.25x this issue asks for and
         * fights the font-size ramp instead of moving with it. Each
         * line-height below is the *old* Tailwind-default line-height for
         * that key, scaled by the same ratio as its font-size and rounded
         * to a whole pixel, so a real 125%-zoom-like uniform scale — not
         * just the font-size — is what call sites actually get:
         *   xs   12->15px (x1.25),  line-height 16->20px  (x1.25)
         *   sm   14->18px (x1.29),  line-height 20->26px  (x1.3)
         *   base 16->20px (x1.25),  line-height 24->30px  (x1.25)
         *   lg   18->22px (x1.22),  line-height 28->34px  (x1.21)
         *   xl   20->25px (x1.25),  line-height 28->35px  (x1.25)
         *   2xl  24->30px (x1.25),  line-height 32->40px  (x1.25)
         */
        xs: ['var(--step--1)', { lineHeight: '1.25rem' } /* 20px, was 16px */],
        sm: ['var(--step-0)', { lineHeight: '1.625rem' } /* 26px, was 20px */],
        base: ['var(--step-1)', { lineHeight: '1.875rem' } /* 30px, was 24px */],
        lg: [
          '1.375rem' /* 22px, was 18px */,
          { lineHeight: '2.125rem' } /* 34px, was 28px */,
        ],
        xl: ['var(--step-2)', { lineHeight: '2.1875rem' } /* 35px, was 28px */],
        '2xl': ['var(--step-3)', { lineHeight: '2.5rem' } /* 40px, was 32px */],
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
