---
name: Aurelian Dark
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#d1c5b4'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#9a8f80'
  outline-variant: '#4e4639'
  surface-tint: '#e8c17a'
  primary: '#f2ca83'
  on-primary: '#412d00'
  primary-container: '#d4af6a'
  on-primary-container: '#5b4205'
  inverse-primary: '#775a1d'
  secondary: '#c4c6cd'
  on-secondary: '#2e3036'
  secondary-container: '#46494f'
  on-secondary-container: '#b6b8bf'
  tertiary: '#bcd0ff'
  on-tertiary: '#1a3057'
  tertiary-container: '#a0b4e3'
  on-tertiary-container: '#31456e'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdea5'
  primary-fixed-dim: '#e8c17a'
  on-primary-fixed: '#271900'
  on-primary-fixed-variant: '#5c4205'
  secondary-fixed: '#e1e2e9'
  secondary-fixed-dim: '#c4c6cd'
  on-secondary-fixed: '#191c21'
  on-secondary-fixed-variant: '#44474c'
  tertiary-fixed: '#d8e2ff'
  tertiary-fixed-dim: '#b2c6f6'
  on-tertiary-fixed: '#011a41'
  on-tertiary-fixed-variant: '#32466f'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
  container-max: 1200px
---

## Brand & Style

This design system draws inspiration from modern desktop computing environments, specifically focusing on the precision and depth of macOS. The aesthetic is professional, premium, and focused, targeting power users who value both utility and high-end visual polish.

The style is a sophisticated blend of **Minimalism** and **Glassmorphism**. It utilizes a dark, monochromatic foundation punctuated by a refined metallic gold primary accent. The user experience should feel responsive and high-fidelity, evoking a sense of calm authority through generous whitespace, subtle translucency, and precise geometry.

## Colors

The palette is anchored in a deep, "ink" black background to provide maximum contrast for the golden primary accents. 

- **Primary (#D4AF6A):** A muted brass/gold used for key actions, active states, and highlights. It suggests quality without being ostentatious.
- **Surface & Background:** The background is near-black (#0D0D0D), while surfaces use a slightly lighter charcoal (#1A1D22) to establish hierarchy.
- **Borders:** A crisp, low-contrast border (#2B2E33) defines edges without creating visual clutter.
- **Typography:** Primary text is a soft white (#E6E6E6) to reduce eye strain, while secondary text is a cool grey (#A0A7AF) for de-emphasized metadata.

## Typography

This design system uses **Inter** exclusively to maintain a systematic, neutral, and highly legible appearance. 

The typographic hierarchy relies on weight and subtle tracking adjustments rather than extreme size variations. Display and headline styles use tighter letter-spacing for a "compact" premium feel, while small labels use increased tracking and uppercase styling for clarity in utility contexts. Use the `label-sm` style specifically for captions, category headers in sidebars, and overline text.

## Layout & Spacing

The layout philosophy follows a **Fixed Grid** approach for content containers, centered within the viewport. 

- **Grid:** A 12-column grid system is used for desktop layouts with 16px gutters.
- **Sidebars:** Sidebars should have a fixed width (typically 240px to 280px) and utilize the glassmorphism effects described in the Elevation section.
- **Rhythm:** All spacing (padding, margins) must be increments of the 4px base unit. 
- **Mobile:** On mobile devices, margins shrink to 16px, and the 12-column grid collapses into a single-column flow.

## Elevation & Depth

Depth is conveyed through a combination of **Glassmorphism** and **Tonal Layers**.

1.  **Glassmorphism:** Navigation sidebars and top-level headers should use a backdrop filter (`blur: 20px`) with a semi-transparent background color (`#1A1D22` at 70% opacity). A 1px internal border (border-top and border-right) using a slightly lighter tint provides a "specular highlight" effect.
2.  **Tonal Layers:** Main content areas use the solid `#0D0D0D` background. Overlays and cards use `#1A1D22`.
3.  **Shadows:** Use extremely soft, large-radius ambient shadows for floating elements (modals, menus). Shadows should be pure black with 40-50% opacity, avoiding any colored tinting to maintain the professional aesthetic.

## Shapes

The design system uses a **Rounded** shape language to mirror the software aesthetic of macOS.

- **Standard Elements:** Buttons, input fields, and small cards use a 0.5rem (8px) corner radius.
- **Large Containers:** Main content cards and modals use a 1rem (16px) corner radius.
- **Selection Indicators:** Active states in sidebars or segmented controls use 6px - 8px radii to fit within their parent containers comfortably.

## Components

- **Buttons:** Primary buttons use the Primary Gold background with black text. Secondary buttons use a transparent background with the Border color and Primary text. Hover states for primary buttons should transition to the Hover Gold.
- **Inputs:** Fields should have a `#1A1D22` background and the `#2B2E33` border. Focus states are indicated by a 1px border of Primary Gold, without a glow or "halo" effect.
- **Sidebars:** Use the glassmorphic style. Active items are indicated by a subtle gold vertical pill (4px wide) on the left edge and a low-opacity gold background tint.
- **Cards:** Cards are defined by the `#2B2E33` border rather than heavy shadows. They should feel like "panels" within the interface.
- **Chips/Badges:** Use a subtle background (10% opacity of the text color) with a slightly bolder font weight for the label.
- **Segmented Controls:** These should resemble the macOS system toggles—a dark track with a slightly raised, lighter `#2B2E33` or `#D4AF6A` slider.

\claude --resume 79b1a742-9ef6-4c7f-8e97-2c7af268bd20