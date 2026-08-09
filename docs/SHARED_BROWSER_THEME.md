# Shared browser theme contract

Seemplify web surfaces use one browser-wide appearance preference. The default is
**System**; Light and Dark are explicit overrides.

## Storage and precedence

| Item | Contract |
| --- | --- |
| Cookie | `seemplify_theme=system|light|dark` |
| Cookie attributes | `Path=/; Max-Age=31536000; SameSite=Lax`; add `Secure` on HTTPS |
| Production scope | Add `Domain=.seemplifyai.com` only on `seemplifyai.com` and its true subdomains |
| Local development | Omit `Domain`; host cookies are shared across localhost ports |
| Local fallback | `localStorage.seemplify_theme` (same-origin only) |
| Legacy migration | `seemplify-theme`, `theme`, and `themeMode` are read only when the shared cookie/key is absent or invalid |
| Default | Missing or invalid values normalize to `system` |

The first-party cookie is the cross-application source of truth. A valid cookie
wins over local storage. A valid legacy/local value is promoted into both the
canonical key and cookie so apps cannot oscillate between preferences. The value
is non-sensitive and intentionally readable by browser JavaScript; it must not
contain account or organization data.

No signed-in server theme preference currently exists in the audited suite. If
one is added later, it may seed a browser that has no valid shared value, but it
must not silently replace an explicit browser override. Account-wide sync should
be an explicit product choice separate from this device/browser contract.

## Rendering contract

Before application hydration, every HTML shell must run the inline bootstrap in
its `<head>`. It sets:

- `data-theme-preference="system|light|dark"` — the saved choice.
- `data-theme="light|dark"` — the resolved palette.
- Root `light` or `dark` class for Tailwind/next-themes consumers.
- CSS `color-scheme` to the resolved palette.

Runtime controls expose three choices with a visible selection and accessible
menu/radio semantics. In System mode, a
`prefers-color-scheme: dark` change updates the resolved palette immediately.
An explicit Light or Dark choice ignores later OS changes. Apps re-read the
cookie on focus/visibility so a change made in another Seemplify app is applied
when the user returns.

New listeners should use `seemplify-theme-change`, whose detail is
`{ preference, resolved }`. The legacy `theme-change` event (resolved string)
is emitted during migration for compatibility.

## Coverage

| Surface | Pre-paint | System/Light/Dark control | Notes |
| --- | --- | --- | --- |
| Marketing | Yes | Header menu | Shared cookie and canonical fallback |
| Identity Provider / App Hub | Yes | User and admin navigation menus | Shared manager used by EJS and recovery shells |
| Recruiter | Yes | Profile and identity-handoff menus | next-themes uses canonical storage key |
| Digilog Recruiter | Yes | Profile/menu controls | Same contract as Recruiter |
| Leave | Yes | Header menu | next-themes uses canonical storage key |
| Payroll | Yes | Desktop and mobile controls | Direct shared contract |
| Performance | Yes | Desktop and mobile controls | MUI mode follows resolved root palette |
| Time & Attendance | Yes | Desktop and mobile controls | Direct shared contract |
| Experience Management | Yes | Application header/editor controls | Vite pre-paint bootstrap and both token palettes |
| Learning | Yes | Shared navigation menu | Light-only forcing removed; both token palettes available |

AI Assistant, Outline, Zulip, and any surface on an unrelated/custom registrable
domain are outside the reach of a `.seemplifyai.com` cookie unless their own
shell implements a signed-in server preference or an explicit trusted
cross-origin synchronization flow. Embedded third-party contexts may also block
cookie access. Do not claim browser-wide propagation across those boundaries.

## Verification

Run the focused contract suite from the repository root:

```bash
npm run test:theme-contract
```

It checks bootstrap parity, System resolution, explicit overrides, invalid-value
normalization, legacy migration, cookie-disabled and storage-disabled fallbacks,
production/localhost/lookalike cookie scope, layout installation, control
coverage, events, and Experience dark tokens. App builds/typechecks remain the
second gate.

