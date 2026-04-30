import { test, expect } from "bun:test";

type Finding = {
  audit: string;
  file: string;
  line: number | null;
  symbol: string | null;
  severity: "high" | "med" | "low";
  principle: string;
  evidence: string;
  recommendation: string;
};

const SEVERITY_WEIGHT = { high: 3, med: 2, low: 1 } as const;

function computeWeights(findings: Finding[]): Array<Finding & { weight: number }> {
  const audits_per_file = new Map<string, Set<string>>();
  for (const f of findings) {
    if (!audits_per_file.has(f.file)) audits_per_file.set(f.file, new Set());
    audits_per_file.get(f.file)!.add(f.audit);
  }

  const symbols_per_file_audit = new Map<string, Map<string, Set<string>>>();
  for (const f of findings) {
    if (!f.symbol) continue;
    if (!symbols_per_file_audit.has(f.file)) symbols_per_file_audit.set(f.file, new Map());
    const fileMap = symbols_per_file_audit.get(f.file)!;
    if (!fileMap.has(f.symbol)) fileMap.set(f.symbol, new Set());
    fileMap.get(f.symbol)!.add(f.audit);
  }

  return findings.map((f) => {
    const distinct = audits_per_file.get(f.file)!.size;
    const convergence = Math.min(3.0, 1 + 0.5 * (distinct - 1));
    let symbol_boost = 1.0;
    if (f.symbol) {
      const auditsOnSymbol = symbols_per_file_audit.get(f.file)?.get(f.symbol);
      if (auditsOnSymbol && auditsOnSymbol.size >= 2) symbol_boost = 1.25;
    }
    const weight = SEVERITY_WEIGHT[f.severity] * convergence * symbol_boost;
    return { ...f, weight };
  });
}

const mk = (audit: string, file: string, severity: Finding["severity"], symbol: string | null = null): Finding => ({
  audit, file, line: null, symbol,
  severity, principle: "test", evidence: "test", recommendation: "test",
});

test("single audit single finding has weight = severity", () => {
  const w = computeWeights([mk("a", "f.ts", "high")]);
  expect(w[0].weight).toBe(3);
});

test("two audits on one file get convergence 1.5", () => {
  const w = computeWeights([mk("a", "f.ts", "high"), mk("b", "f.ts", "high")]);
  expect(w[0].weight).toBe(4.5);
  expect(w[1].weight).toBe(4.5);
});

test("convergence caps at 3.0 (5 audits)", () => {
  const fs = ["a","b","c","d","e"].map((a) => mk(a, "f.ts", "high"));
  const w = computeWeights(fs);
  for (const x of w) expect(x.weight).toBe(9);
});

test("symbol shared across two audits on same file gets 1.25 boost", () => {
  const fs = [mk("a", "f.ts", "high", "Foo"), mk("b", "f.ts", "high", "Foo")];
  const w = computeWeights(fs);
  expect(w[0].weight).toBeCloseTo(3 * 1.5 * 1.25, 5);
});

test("symbol on only one audit's finding does NOT get boost", () => {
  const fs = [mk("a", "f.ts", "high", "Foo"), mk("b", "f.ts", "high", "Bar")];
  const w = computeWeights(fs);
  expect(w[0].weight).toBeCloseTo(3 * 1.5, 5);
  expect(w[1].weight).toBeCloseTo(3 * 1.5, 5);
});

test("worked example from spec", () => {
  const fs = [
    mk("coupling-auditor", "src/checkout/order.ts", "high", "OrderService.applyDiscount"),
    mk("cohesion-analyzer", "src/checkout/order.ts", "med", "OrderService.applyDiscount"),
    mk("complexity-accountant", "src/checkout/order.ts", "high", "OrderService"),
  ];
  const w = computeWeights(fs);
  expect(w[0].weight).toBeCloseTo(7.5, 5);
  expect(w[1].weight).toBeCloseTo(5.0, 5);
  expect(w[2].weight).toBeCloseTo(6.0, 5);
});
