export interface Ledger {
  [key: string]: { introduced_in: number };
}

export function keyExists(ledger: Ledger, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(ledger, key);
}

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

export function placeholderVars(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) out.push(m[1]);
  return out;
}

export function countWords(text: string): number {
  const t = text.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}

export function requiresVars(requires: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (typeof o.var === "string") {
      out.push(o.var);
      return;
    }
    if (Array.isArray(o.all)) o.all.forEach(walk);
    if (Array.isArray(o.any)) o.any.forEach(walk);
    if (o.not !== undefined) walk(o.not);
  };
  walk(requires);
  return out;
}
