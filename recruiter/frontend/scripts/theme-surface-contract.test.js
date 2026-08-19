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

test("AI interview dark mode uses semantic transcript and candidate notice surfaces", () => {
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
});
