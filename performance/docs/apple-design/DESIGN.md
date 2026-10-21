# Performance Management design contract

21 October 2026. UI/UX1: coordinator. Inputs: AD-01..AD-12, architecture-01, current source and synthetic baseline dashboard screenshot. Applies only to Performance Management.

## Product cognition and direction

Established HR workspace. Employees update goals, assessments, feedback and growth; managers review team work; HR configures cycles and reviews organization outcomes. Entry is Identity -> workspace dashboard -> scoped task -> save/submit -> observable status. The first decision is which current task to continue. Recovery uses existing retry, draft, cancel and back actions. Mobile must keep that same primary task reachable. Tone: calm, clear, operational. Internal API/provider/version names belong in diagnostics only when they help a user decide.

Keep Next/MUI/Tailwind/SWR, data visualization, business terminology and permissions. Refactor shared presentation and individually audit hardcoded exceptions. Avoid decorative headers, gradients on actions, competing fonts, equal-weight card walls and global `nav` overrides. No new animation dependency or gesture feature is needed.

## 1. Source and concept

Reference: [Emil Kowalski Apple design](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md), read in full. Baseline `evidence/before/dashboard-light.png` is the actual app with controlled synthetic data. Generated proposal `evidence/concepts/dashboard-apple-concept.png` is explicitly a concept, not a delivered screenshot. Its visual direction informs implementation; existing route/task content remains authoritative.

## 2. Shared foundations: AD-01

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | #f5f5f7 | #101114 |
| Surface | #ffffff | #1c1d21 |
| Muted surface | #eeeef2 | #25262b |
| Main text | #1d1d1f | #f5f5f7 |
| Secondary text | #62636b | #b0b1bb |
| Separator | #dcdde3 | #393a43 |
| Strong edge | #858791 | #777a87 |
| Action / focus | #0066cc | #64a7ff |
| On primary action | #ffffff | #071426 |

Semantic success/warning/danger retain independent colors and text/icons. Charts retain distinguishable series. Shared `--suite-*` variables map to all legacy suite classes, semantic Tailwind tokens and MUI palette. Portals consume the same palette.

System font: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Body 14-16px equivalent, line-height 1.5; page headings 28-32px, weight 650-700, line-height 1.18, tracking -0.025em; section titles 18-20px, weight 600, line-height 1.3. Small labels use normal case and slightly positive tracking. Numeric comparisons use tabular figures. Keep exported typography responsive in rem/clamp units.

Spacing: 4/8/12/16/24/32/40px equivalents. Content max width 1280px; comfortable 16px mobile and 32px desktop gutters. Controls 8-10px corner radius; grouped panels 12px. Modal surfaces may use 16px. Borders convey grouping; restrained shadows convey an overlapping surface only. Do not lift static cards on hover.

Top navigation keeps current information architecture. Use a near-solid translucent material over scrolling content; nested competency navigation stays a content toolbar. Current links expose `aria-current`. A visible skip link leads to the focusable main region. Keyboard menus focus an item, support arrows/Home/End/Escape and return focus; mobile navigation traps focus and restores its trigger. Retain actual organization/workspace labels and claims-derived options.

## 3. Core screen contracts: AD-02..AD-06

- Dashboard: compact page header and organization context; metrics before work; three role-specific task destinations in a balanced grid, 1 column on mobile. Use the existing data/links and a short heading. Manager notifications remain visually actionable. Utility help is secondary to task actions.
- Goals/alignment: preserve scope/period/current-past-upcoming controls, status, progress and existing decision ownership. Tabs use a clear underline; filters wrap and keep their labels. Detail and create dialogs use the same typography/input/action hierarchy. Long objective names wrap; progress is never invented for unrated goals.
- Appraisals/reviews: group participant/status/date and current action; remove decorative gradient strips. Keep draft, overdue, final, removed and read-only distinctions. Step navigation and headings remain clear. Published results remain readable on white print pages. Conversational assessment uses plain message surfaces, not a moving atmospheric canvas.
- Cycles/admin: keep existing staged form and validation; align labels and action buttons; preserve frozen launched cycles. Tables scroll inside their region on compact screens. Filters precede records; export actions remain associated with the displayed report.
- People/analytics: retain identity and team scope, accessible filters, readable metric precision and chart keys. No automatic rating or talent decisions. Dense numeric tables keep comparison alignment.

## 4. Growth and competency: AD-07..AD-12

Apply the same controls, surface tokens and headings. DESIGN-02 documents family-specific states and evidence. Do not alter anonymity/cohort thresholds, recording consent, optional AI requirements, participant visibility, finalization or review ownership. Calendar/provider disconnected/error states must remain actionable. Legacy/redirect screens inherit foundations without adding business controls.

## 5. Interaction and accessibility

Pointer-down receives immediate background/opacity feedback through `:active`; actions still commit through the existing click/submit handler. Keep native cancellation behavior and busy/disabled guards. No input lock while transitions finish. Standard color/opacity transitions last 120-160ms. Avoid `transition: all`, hover translations and decorative infinite loops.

Use `prefers-reduced-motion` to remove nonessential spatial/shimmer/looping animation while preserving status labels. Use `prefers-reduced-transparency` and no-blur fallback for solid chrome. Use `prefers-contrast: more` and forced-colors to restore visible boundaries and system focus. Keep a 2px focus ring with offset, semantic labels, scroll-margin below the fixed header, and touch targets at least 44px for primary/touch actions where layout allows. Compact desktop utilities retain accessible spacing.

At 390px and 200% zoom, page actions wrap; dialogs fit the viewport and scroll internally; form inputs remain at least 16px on touch to avoid unintended browser zoom. Tables may overflow within their container, not the document. Do not hide document overflow as a substitute for repairing the responsible component.

## 6. Review and development gate

Product and architecture review this document and each story before developers begin. Pair development lanes follow the ownership contract. After implementation, compare actual screens in light/dark desktop/mobile and verify menu/dialog/keyboard/recovery behavior. Record reviewed evidence and exceptions, never infer all-route verification solely from a shared stylesheet.
