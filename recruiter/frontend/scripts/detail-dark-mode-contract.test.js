const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");

const candidateDetail = read("app", "candidates", "[id]", "page.tsx");
const jobDetail = read("app", "jobs", "[jobId]", "page.tsx");
const tabNavigation = read("components", "ui", "simple-tab-navigation.tsx");

test("candidate detail keeps its canvas and primary cards readable in dark mode", () => {
  assert.match(candidateDetail, /dark:from-slate-950 dark:via-slate-950 dark:to-slate-900/);
  assert.match(candidateDetail, /dark:border-slate-800 dark:bg-slate-900/);
  assert.match(candidateDetail, /rounded-t-lg border-b bg-muted\/40/);
  assert.match(candidateDetail, /dark:border-blue-800 dark:bg-blue-950\/40 dark:text-blue-300/);
  assert.match(candidateDetail, /dark:border-slate-700 dark:bg-slate-900 sm:p-5/);
});

test("job detail public application controls remain legible in dark mode", () => {
  assert.match(jobDetail, /dark:border-green-800 dark:bg-slate-900/);
  assert.match(jobDetail, /break-all dark:text-gray-200/);
  assert.match(jobDetail, /Public Job Link:<\/label>/);
  assert.match(jobDetail, /text-gray-700 dark:text-gray-300/);
});

test("desktop job-detail navigation has complete dark-mode states", () => {
  assert.match(tabNavigation, /dark:border-slate-800 dark:bg-slate-900/);
  assert.match(tabNavigation, /dark:bg-slate-800/);
  assert.match(tabNavigation, /dark:bg-blue-950\/40 dark:text-blue-300/);
  assert.match(tabNavigation, /dark:hover:border-slate-600 dark:hover:bg-slate-700/);
  assert.match(tabNavigation, /dark:focus:ring-offset-slate-900/);
});
