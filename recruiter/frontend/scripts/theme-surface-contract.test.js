const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const interviewPage = fs.readFileSync(
  path.join(root, "app", "ai-interviews", "page.tsx"),
  "utf8"
);
const interviewTheme = fs.readFileSync(
  path.join(root, "app", "ai-interviews", "ai-interviews.css"),
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
  assert.match(suiteTheme, /\.dark\s*\{[\s\S]*--suite-surface:/);
});
