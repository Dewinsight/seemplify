import crypto from "node:crypto";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
    .map((key) => [key, normalize((value as Record<string, unknown>)[key])]));
}

export function canonical(value: unknown) { return JSON.stringify(normalize(value)); }
export function digest(value: unknown) { return crypto.createHash("sha256").update(canonical(value)).digest("hex"); }

function readPath(root: unknown, path: string) {
  return path.split(".").filter(Boolean).reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[key];
  }, root);
}

export interface RuntimeValues {
  event: Record<string, unknown>;
  steps: Record<string, { output: Record<string, unknown> }>;
  approval?: { id: string; decision?: "approved" | "rejected"; rationale?: string };
}

export function resolveValue(value: unknown, runtime: RuntimeValues): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, runtime));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, resolveValue(item, runtime)]));
  }
  if (typeof value !== "string") return value;
  const exact = value.match(/^\$(event|steps|approval)\.(.+)$/u);
  if (exact) return readPath(runtime[exact[1] as keyof RuntimeValues], exact[2]);
  return value.replace(/\{\{\$(event|steps|approval)\.([^}]+)\}\}/gu, (_match, root: keyof RuntimeValues, path: string) => {
    const resolved = readPath(runtime[root], path);
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}

export function resolveInput(input: Record<string, unknown>, runtime: RuntimeValues) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, resolveValue(value, runtime)]));
}
