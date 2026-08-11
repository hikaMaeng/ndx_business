#!/usr/bin/env node
// Does a Node version satisfy an engines-style range?
//
//   node scripts/node-range.mjs "<range>" "<version>"   exit 0 = satisfied
//
// Supports the subset this repository declares: comparators separated by
// whitespace are ANDed, clauses separated by || are ORed. That is enough to
// express an excluded middle window (">=a <b || >=c <d"), which a plain
// ceiling cannot.
//
// Deliberately dependency-free and package-free: the deploy preflight calls it
// to diagnose a broken module loader, so it must run when package resolution
// is exactly what is broken.

const compareVersions = (left, right) => {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
};

export const satisfies = (range, version) =>
  range.split("||").some((clause) =>
    clause
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((comparator) => {
        const parsed = /^(>=|<=|<|>|=)?v?(\d+(?:\.\d+){0,2})$/.exec(comparator);
        if (!parsed) return true;
        const delta = compareVersions(version, parsed[2]);
        switch (parsed[1] || "=") {
          case ">=":
            return delta >= 0;
          case ">":
            return delta > 0;
          case "<=":
            return delta <= 0;
          case "<":
            return delta < 0;
          default:
            return delta === 0;
        }
      })
  );

const [range, version] = process.argv.slice(2);
if (range !== undefined && version !== undefined) {
  process.exit(satisfies(range, version) ? 0 : 1);
}
