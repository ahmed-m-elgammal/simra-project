const OPS = new Set(["==", "!=", "<", "<=", ">", ">="]);
const VAR = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

type Atom = { var: string; op: string; value: number };
type Node = { all: Node[] } | { any: Node[] } | { not: Node } | Atom;

function isAtom(n: Node): n is Atom {
  return typeof (n as Atom).var === "string";
}

function compileNode(n: Node, knownVars: Set<string> | null): string {
  if (isAtom(n)) {
    if (!OPS.has(n.op)) throw new Error(`unknown op: ${n.op}`);
    if (!VAR.test(n.var)) throw new Error(`bad var name: ${n.var}`);
    if (knownVars && !knownVars.has(n.var)) throw new Error(`unknown var: ${n.var}`);
    if (typeof n.value !== "number" || Number.isNaN(n.value)) throw new Error(`bad value for ${n.var}`);
    const access = `((s[${JSON.stringify(n.var)}]) ?? 0)`;
    if (n.op === "==") return `(${access} === ${n.value})`;
    if (n.op === "!=") return `(${access} !== ${n.value})`;
    return `(${access} ${n.op} ${n.value})`;
  }
  if ("all" in n) return `(${(n.all as Node[]).map((c) => compileNode(c, knownVars)).join(" && ") || "true"})`;
  if ("any" in n) return `(${(n.any as Node[]).map((c) => compileNode(c, knownVars)).join(" || ") || "false"})`;
  return `(!${compileNode((n as { not: Node }).not, knownVars)})`;
}

export function compileRequires(requires: unknown, knownVars?: string[]): string {
  if (requires === null) return "true";
  return `s => ${compileNode(requires as Node, knownVars ? new Set(knownVars) : null)}`;
}

export function compileBand(predicate: unknown, knownVars?: string[]): string {
  return compileRequires(predicate, knownVars);
}
