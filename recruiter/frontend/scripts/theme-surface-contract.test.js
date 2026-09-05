const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const interviewPage = fs.readFileSync(
  path.join(root, "app", "ai-interviews", "page.tsx"),
  "utf8"
);
const interviewDetailPage = fs.readFileSync(
  path.join(root, "app", "ai-interviews", "[id]", "page.tsx"),
  "utf8"
);
const candidateInterviewPage = fs.readFileSync(
  path.join(root, "app", "public", "ai-interview", "[token]", "page.tsx"),
  "utf8"
);
const interviewTheme = fs.readFileSync(
  path.join(root, "app", "ai-interviews", "ai-interviews.css"),
  "utf8"
);
const interviewBrandTheme = fs.readFileSync(
  path.join(root, "styles", "ai-interview-brand.css"),
  "utf8"
);
const suiteTheme = fs.readFileSync(
  path.join(root, "styles", "suite-theme.css"),
  "utf8"
);
const rootLayout = fs.readFileSync(path.join(root, "app", "layout.tsx"), "utf8");
const themeProvider = fs.readFileSync(
  path.join(root, "components", "env-theme-provider.tsx"),
  "utf8"
);
const themeConfig = fs.readFileSync(
  path.join(root, "config", "theme.config.ts"),
  "utf8"
);
const themeSync = fs.readFileSync(path.join(root, "lib", "theme-sync.ts"), "utf8");
const topNavbar = fs.readFileSync(path.join(root, "components", "TopNavbar.tsx"), "utf8");
const identityHandoff = fs.readFileSync(
  path.join(root, "components", "auth", "IdentityHandoff.tsx"),
  "utf8"
);

test("Recruiter is light-only without changing the suite-wide preference", () => {
  assert.match(themeConfig, /lightEnabled:\s*true/);
  assert.match(themeConfig, /darkEnabled:\s*false/);
  assert.match(themeConfig, /systemEnabled:\s*false/);
  assert.match(themeConfig, /defaultTheme:\s*'light'/);

  assert.match(rootLayout, /className="light"/);
  assert.match(rootLayout, /data-theme="light"/);
  assert.match(rootLayout, /recruiterThemeInitScript/);
  assert.doesNotMatch(rootLayout, /dangerouslySetInnerHTML=\{\{ __html: themeInitScript \}\}/);

  assert.match(themeProvider, /forcedTheme=\{RECRUITER_THEME\}/);
  assert.match(themeProvider, /enableSystem=\{false\}/);
  assert.match(themeProvider, /new MutationObserver\(enforceLightTheme\)/);
  assert.doesNotMatch(themeProvider, /readThemePreference|syncThemeToCookie|setTheme/);

  const lightInit = themeSync.match(/export const recruiterThemeInitScript = `([^`]+)`;/)?.[1] || "";
  assert.match(lightInit, /classList\.remove\('dark'\)/);
  assert.match(lightInit, /classList\.add\('light'\)/);
  assert.doesNotMatch(lightInit, /localStorage|document\.cookie|seemplify_theme/);

  assert.doesNotMatch(topNavbar, />Appearance</);
  assert.doesNotMatch(topNavbar, /setTheme|useTheme/);
  assert.doesNotMatch(identityHandoff, /ThemeToggle/);
});

test("AI interview cards use theme-aware surfaces", () => {
  const semanticSurfaces = [
    "ai-interviews-wizard__header",
    "ai-interviews-summary",
    "ai-interviews-ranking-header",
  ];

  for (const className of semanticSurfaces) {
    const elements = interviewPage.match(
      new RegExp(`<[^>]+className="[^"]*\\b${className}\\b[^"]*"[^>]*>`, "g")
    );

    assert.ok(elements?.length, `${className} should remain present`);
    for (const element of elements) {
      assert.doesNotMatch(
        element,
        /(?:^|\s)(?:bg-(?:slate|gray|zinc|neutral)-(?:800|900|950)|bg-black|text-white)(?:\s|$)/,
        `${className} must not force a dark-mode surface in light mode`
      );
    }
  }

  assert.match(interviewTheme, /\.ai-interviews-summary\s*\{[^}]*background:\s*var\(--suite-surface\)/s);
  assert.match(
    interviewBrandTheme,
    /\.ai-interviews-workspace \.ai-interviews-summary\s*\{[^}]*background:\s*var\(--ai-surface\)/s
  );
  assert.match(
    interviewBrandTheme,
    /\.ai-interviews-workspace \.ai-interviews-voice-card\.is-selected\s*\{[^}]*background:\s*var\(--ai-violet-soft\)/s
  );
  assert.match(
    interviewBrandTheme,
    /\.dark \.ai-interviews-workspace \.ai-interviews-summary\s*\{[^}]*background:\s*var\(--ai-ink\)/s
  );
  assert.match(suiteTheme, /\.dark\s*\{[\s\S]*--suite-surface:/);
});

test("AI interview detail uses semantic transcript and candidate notice surfaces", () => {
  for (const className of [
    "ai-interview-transcript-panel__header",
    "ai-interview-transcript-panel__stat",
    "ai-interview-transcript-panel__body",
  ]) {
    assert.match(interviewDetailPage, new RegExp(`\\b${className}\\b`));
  }

  for (const className of [
    "candidate-interview-briefing__hero",
    "candidate-interview-proctoring",
    "candidate-interview-proctoring__rule",
    "candidate-interview-guidelines",
    "candidate-interview-start-panel",
  ]) {
    assert.match(candidateInterviewPage, new RegExp(`\\b${className}\\b`));
  }

  assert.match(
    interviewBrandTheme,
    /\.ai-interview-detail \.ai-interview-transcript-panel__header\s*\{[^}]*background:\s*var\(--ai-surface-muted\)/s
  );
  assert.match(
    interviewBrandTheme,
    /\.dark \.candidate-interview-page \.candidate-interview-proctoring,[\s\S]*background:\s*color-mix\(/s
  );
  assert.match(
    interviewTheme,
    /\.ai-interview-detail \.text-slate-950,\s*\.ai-interview-detail \.text-slate-900,[\s\S]*color:\s*var\(--suite-ink\)/s
  );
  assert.match(
    interviewTheme,
    /\.ai-interview-detail \.bg-slate-100\s*\{[^}]*background:\s*var\(--suite-surface-muted\)/s
  );
  assert.match(
    interviewTheme,
    /\.ai-interview-detail \.bg-slate-200\s*\{[^}]*background:\s*var\(--suite-line\)/s
  );
  assert.match(
    interviewTheme,
    /\.dark \.ai-interview-detail \.bg-slate-950\s*\{[^}]*background:\s*#7047eb/s
  );
  assert.match(
    interviewDetailPage,
    /isCandidate \? "text-white" : "text-muted-foreground"/
  );
});
