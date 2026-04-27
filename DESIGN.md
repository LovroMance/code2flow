# Code2Flow Workspace Redesign

## 1. Visual Theme & Atmosphere

- Theme name: `Midnight Terminal Finance`
- Atmosphere keywords: `dark`, `commanding`, `high-contrast`, `premium`, `dashboard-editorial`
- One-line direction: Keep Code2Flow as a developer tool, but package it with the visual confidence of a high-end fintech landing page.
- Visual translation from the reference:
  - oversized headline energy
  - matte-black canvas with restrained gray layering
  - pill navigation and dense utility controls
  - large right-side product surface framed like a premium device
- Product adaptation:
  - left side becomes the “analysis command deck”
  - right side becomes the “visual result device”
  - code editor and diagram remain visible, but are reframed as polished product modules

## 2. Color Palette & Roles

```css
:root {
  --bg-page: #050505;
  --bg-page-rgb: 5, 5, 5;
  --bg-shell: #0c0c0d;
  --bg-shell-rgb: 12, 12, 13;
  --bg-panel: #131314;
  --bg-panel-rgb: 19, 19, 20;
  --bg-panel-soft: #1b1b1d;
  --bg-panel-soft-rgb: 27, 27, 29;
  --bg-elevated: #232326;
  --bg-elevated-rgb: 35, 35, 38;

  --text-primary: #f5f5f2;
  --text-primary-rgb: 245, 245, 242;
  --text-secondary: #a7a7ab;
  --text-secondary-rgb: 167, 167, 171;
  --text-muted: #74747a;
  --text-muted-rgb: 116, 116, 122;
  --text-inverse: #050505;
  --text-inverse-rgb: 5, 5, 5;

  --border-soft: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.16);
  --border-accent: rgba(255, 255, 255, 0.24);

  --accent-primary: #f3f3ef;
  --accent-primary-rgb: 243, 243, 239;
  --accent-success: #7fe0cc;
  --accent-success-rgb: 127, 224, 204;
  --accent-warm: #d0d0d4;
  --accent-warm-rgb: 208, 208, 212;
  --accent-danger: #ff8d8d;
  --accent-danger-rgb: 255, 141, 141;

  --shadow-soft: 0 20px 40px rgba(0, 0, 0, 0.28);
  --shadow-strong: 0 32px 80px rgba(0, 0, 0, 0.46);
}
```

- Page background uses near-black solid base with subtle radial bloom only in corners.
- Primary CTA uses light-on-dark inversion.
- Positive metrics and success states use mint-green.
- Error states remain muted red, never neon.

## 3. Typography Rules

- Primary display family: `"Space Grotesk", "Aptos", "Segoe UI", sans-serif`
- Secondary UI family: `"Inter", "Aptos", "Segoe UI", sans-serif`
- Monospace family: `"JetBrains Mono", "Cascadia Code", monospace`
- Google Fonts URL:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;700&display=swap');
```

- Type scale:

| Usage         | Size                      | Weight    | Notes                               |
| ------------- | ------------------------- | --------- | ----------------------------------- |
| Hero display  | `clamp(64px, 8vw, 124px)` | `700`     | tight line height, all caps allowed |
| Section title | `28px - 40px`             | `600-700` | high contrast                       |
| Panel title   | `18px - 22px`             | `600`     | compact                             |
| Body          | `14px - 16px`             | `400-500` | neutral                             |
| Meta / labels | `11px - 12px`             | `500-600` | uppercase tracking                  |

- Prohibited:
  - serif display typography
  - rounded playful fonts
  - low-contrast gray-on-gray headings

## 4. Component Stylings

```css
.workspace-shell-card {
  background: linear-gradient(180deg, rgba(19, 19, 20, 0.96), rgba(12, 12, 13, 0.98));
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 32px;
  box-shadow: var(--shadow-strong);
}

.toolbar-pill {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary);
}

.toolbar-pill:hover {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.05);
}

.toolbar-pill:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(243, 243, 239, 0.16);
}

.primary-chip-button {
  background: var(--accent-primary);
  color: var(--text-inverse);
  border-radius: 999px;
  border: 0;
}

.metric-card {
  padding: 20px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.device-frame {
  padding: 18px;
  border-radius: 40px;
  background: linear-gradient(180deg, #171718, #111112);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.55);
}

.language-select {
  appearance: none;
  border-radius: 999px;
  background: #1b1b1d;
  color: var(--text-primary);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
```

- Buttons:
  - default: dark pill, thin border, white text
  - hover: border and fill lighten slightly
  - active: translateY(1px), slightly darker fill
  - focus: soft white ring
  - disabled: opacity `0.5`, no transform
- Editor shell:
  - keep Monaco dark
  - frame editor with deep rounded container and utility toolbar above
- Diagram shell:
  - wrap diagram in “device” style container inspired by reference
  - controls become compact icon-like pills
- Status pills:
  - compact, monochrome, with success highlight only when active
- Upload + sample + clear actions:
  - grouped as top nav pills, not utility buttons floating independently

## 5. Layout Principles

- Desktop composition:
  - top header runs full width
  - left: command deck + hero messaging + editor
  - right: diagram device
- Grid:
  - primary columns: `minmax(0, 1.08fr) minmax(420px, 0.92fr)`
  - column gap: `28px`
- Spacing scale:
  - `8 / 12 / 16 / 20 / 28 / 36 / 48`
- Container:
  - page max width: `1480px`
  - outer padding: `28px`
- Left zone should feel more editorial.
- Right zone should feel more productized and vertically self-contained.

## 6. Depth & Elevation

- Page shell uses one dominant elevation block.
- Inner panels use subtle matte layering rather than bright gradients.
- Device frame on the diagram side carries the deepest shadow.
- Hover elevation rules:
  - pills: tiny lift
  - cards: soft border glow + slight translateY
  - no exaggerated floating effects

## 7. Animation & Interaction

- Interaction level: `L1`
- Motion goals:
  - feel refined, immediate, premium
  - no parallax, no pinned scroll, no gimmicky motion

```css
.fade-rise-in {
  opacity: 0;
  transform: translateY(14px);
  animation: fadeRiseIn 560ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

@keyframes fadeRiseIn {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.hover-card {
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    background 180ms ease;
}

.hover-card:hover {
  transform: translateY(-2px);
}
```

- Required motion behaviors:
  - topbar and hero enter with staggered fade-rise
  - button hover is subtle and immediate
  - cards and language selector get small lift feedback
  - diagram device can keep existing pan/zoom behavior unchanged
- `prefers-reduced-motion`:
  - disable stagger and transform
  - keep opacity changes minimal

## 8. Do's and Don'ts

- Do keep the page predominantly black and monochrome.
- Do use very large display text in the left column.
- Do preserve the existing interaction logic and state wiring.
- Do make the right panel resemble a premium app device or dashboard frame.
- Do keep controls tactile but restrained.
- Do surface language and file metadata as polished utility UI.
- Do let the editor remain obviously editable and functional.
- Do preserve clear error visibility.

- Don’t add colorful gradients as a primary theme.
- Don’t introduce fintech mock data that conflicts with the real product purpose.
- Don’t make the editor or diagram look playful or cartoonish.
- Don’t collapse both panes into identical cards.
- Don’t hide operational controls behind hover-only affordances.
- Don’t use serif fonts, neon accents, or glossy glassmorphism.
- Don’t alter any Vue event wiring, SSE handling, or Monaco behavior.
- Don’t add interactions that suggest draggable split panes or fake tabs unless they really work.

## 9. Responsive Behavior

- Breakpoints:
  - desktop: `>= 1200px`
  - tablet: `768px - 1199px`
  - mobile: `<= 767px`
- Desktop:
  - maintain two-column composition
- Tablet:
  - stack hero/editor above diagram
  - preserve device frame around diagram
- Mobile:
  - headline scales down aggressively
  - top actions become full-width stacked pills
  - editor and diagram keep strong rounded cards but reduce padding
  - touch targets remain at least `44px`
- No horizontal overflow at any breakpoint.
- Diagram toolbar may wrap on mobile, but must remain usable.
