# SmartHR Frontend – Mobile/Responsive Audit

Scope: quick, code-level review of the `frontend/app` surface (landing, global layout, login, jobs, candidates) with emphasis on mobile and narrow viewports.

## Findings

1) **Global zoom is disabled everywhere**  
   - Evidence: `frontend/app/layout.tsx:37-41` sets `maximum-scale=1.0, user-scalable=0`; `frontend/app/responsive-fixes.css:380-384` forces `touch-action: manipulation` on `html, body`.  
   - Impact: mobile users cannot pinch-zoom (accessibility violation WCAG 1.4.4) and iOS double-tap zoom is blocked; also interferes with assistive tech and makes form fields hard to read on smaller screens.  
   - Fix: change the viewport meta to `width=device-width, initial-scale=1` and drop the `user-scalable`/`maximum-scale` lock; remove the global `touch-action` override or scope it only to components that truly need gesture handling.

2) **Over-aggressive global overrides for all screens ≤1079px**  
   - Evidence: `frontend/app/responsive-fixes.css:4-340` repeats the same `@media (max-width: 1079px)` three times with heavy `!important` overrides on typography, spacing, grids, and container widths. Tables are forced to `min-width: 600px` (`frontend/app/responsive-fixes.css:361-363`). GPU forcing on all elements for iOS (`lines 451-459`) runs for every small screen.  
   - Impact: laptops/tablets (1024px) are treated like tiny phones—text shrinks, spacing collapses, and Tailwind breakpoints lose effect. The hard `min-width: 600px` guarantees sideways scrolling on phones; the universal `translateZ(0)` hurts text rendering and battery life.  
   - Fix: replace these overrides with Tailwind utilities at standard breakpoints (`lg`, `md`, `sm`), remove `!important` usage, and scope chart/table tweaks to their containers. Drop the global GPU transform and set table responsiveness via wrappers (e.g., `overflow-x-auto` + `min-w-max` on the table element) instead of global min-width.

3) **Login page is height-locked and non-scrollable on mobile**  
   - Evidence: `frontend/app/login/page.tsx:298-299` wraps the page in `div` with `h-screen ... overflow-hidden`; the inner container also uses `flex h-screen` (`line 324`).  
   - Impact: when the mobile keyboard opens, the form cannot scroll; content can be clipped behind the keyboard or safe-area insets. Long error states/OTP flows risk being unreachable on small devices.  
   - Fix: switch outer wrappers to `min-h-screen` with `overflow-y-auto` and `pb` that respects `safe-area-inset-bottom`; allow the form column to scroll independently and tone down heavy background layers on small viewports to reduce jank.

4) **Jobs list view flickers into desktop table on first paint**  
   - Evidence: `frontend/app/jobs/page.tsx:683-687` renders the table by default and swaps to grid only after the client measures `window.innerWidth`. `view` defaults to `"table"` and only flips inside `useEffect`.  
   - Impact: on mobile SSR, users briefly see a wide table that forces horizontal scroll until hydration finishes; orientation changes also lag behind the CSS state.  
   - Fix: derive the view from a media query hook (`useMobile`) or CSS (show both and hide with `md:` classes) so the initial HTML matches the mobile layout. At minimum, default to grid for SSR and wrap the table in `overflow-x-auto` for sub-1024px widths.

5) **Candidates table has no horizontal guard on small tablets**  
   - Evidence: `frontend/app/candidates/page.tsx:737-786` renders a wide table with 6+ columns and no `overflow-x-auto` wrapper; the mobile card view only activates below 768px via `useMobile`.  
   - Impact: devices between 768–900px (common tablets in portrait) get the full table, which overflows the viewport and introduces horizontal scroll on the page body.  
   - Fix: wrap the table in a scroll container (`div` or `ScrollArea`) and/or bump the mobile card breakpoint to ~1024px. Consider a column-priority stack (name/position/stage) for sub-900px to keep content readable without sideways scrolling.

## Recommended next steps
- Refactor `responsive-fixes.css` into component-scoped Tailwind classes with sensible breakpoints; remove global `!important` rules and the forced GPU transforms.
- Adjust the global viewport/touch settings to re-enable user zoom and only disable gestures where absolutely necessary.
- Make the auth and data tables scroll-friendly: `min-h-screen` + `overflow-y-auto` on login, and add horizontal scroll wrappers/stacked layouts for jobs/candidates at tablet widths.
