// Recipes are tools the agent writes for itself: a named list of construct
// steps with parameters. Any number in a step may be an expression over the
// parameters, so "midpoint of A and B" is "($A.x + $B.x) / 2", not arithmetic
// done in the model's head.

export type ParamValue = number | string | { x: number; y: number };

const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  hypot: Math.hypot,
  sin: (d) => Math.sin((d * Math.PI) / 180),
  cos: (d) => Math.cos((d * Math.PI) / 180),
  tan: (d) => Math.tan((d * Math.PI) / 180),
  atan2: (y, x) => (Math.atan2(y, x) * 180) / Math.PI,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};

/**
 * Evaluate a small arithmetic expression: numbers, + - * / ^, parentheses,
 * $param, $point.x / $point.y, and the functions above (angles in degrees).
 */
export function evaluate(expr: string, params: Record<string, ParamValue>): number {
  const tokens = tokenize(expr);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const expect = (t: string) => {
    if (next() !== t) throw new Error(`expected ${t} in "${expr}"`);
  };
  const primary = (): number => {
    const t = next();
    if (t === undefined) throw new Error(`unexpected end of "${expr}"`);
    if (t === "(") {
      const v = sum();
      expect(")");
      return v;
    }
    if (t === "-") return -primary();
    if (t === "+") return primary();
    if (/^\d/.test(t)) return Number(t);
    if (t.startsWith("$")) return param(t.slice(1));
    if (/^[a-z]+$/i.test(t)) {
      const fn = FUNCTIONS[t];
      if (!fn) throw new Error(`unknown function ${t}`);
      expect("(");
      const args: number[] = [];
      if (peek() !== ")") {
        args.push(sum());
        while (peek() === ",") {
          next();
          args.push(sum());
        }
      }
      expect(")");
      return fn(...args);
    }
    throw new Error(`unexpected "${t}" in "${expr}"`);
  };
  const power = (): number => {
    const base = primary();
    if (peek() === "^") {
      next();
      return base ** power();
    }
    return base;
  };
  const product = (): number => {
    let v = power();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const r = power();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const param = (ref: string): number => {
    const [name, field] = ref.split(".");
    if (!(name in params)) throw new Error(`unknown parameter $${name}`);
    const v = params[name];
    if (typeof v === "number") {
      if (field) throw new Error(`$${name} is a number, not a point`);
      return v;
    }
    if (typeof v === "string") throw new Error(`$${name} is text and cannot be used in arithmetic`);
    if (field !== "x" && field !== "y") throw new Error(`use $${name}.x or $${name}.y`);
    return v[field];
  };
  const value = sum();
  if (i !== tokens.length) throw new Error(`unexpected "${tokens[i]}" in "${expr}"`);
  if (!Number.isFinite(value)) throw new Error(`"${expr}" is not a finite number`);
  return value;
}

function tokenize(expr: string): string[] {
  const out: string[] = [];
  const re = /\s*(\d+\.?\d*|\$[A-Za-z_][A-Za-z0-9_]*(?:\.[xy])?|[A-Za-z]+|[()+\-*/^,])/gy;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(expr)) !== null) {
    out.push(m[1]);
    last = re.lastIndex;
  }
  if (last !== expr.length && expr.slice(last).trim() !== "") throw new Error(`cannot read "${expr.slice(last)}" in "${expr}"`);
  return out;
}

/**
 * Replace expression strings anywhere inside a step with numbers. A string that
 * names a point parameter ("$A") becomes that point; anything else with a "$"
 * or an operator is evaluated; plain text is left alone.
 */
export function substitute(value: unknown, params: Record<string, ParamValue>): unknown {
  if (typeof value === "string") {
    const whole = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(value.trim());
    if (whole) {
      const v = params[whole[1]];
      if (v === undefined) throw new Error(`unknown parameter $${whole[1]}`);
      return typeof v === "object" ? { ...v } : v;
    }
    if (value.includes("$")) return evaluate(value, params);
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, params));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitute(v, params);
    return out;
  }
  return value;
}
