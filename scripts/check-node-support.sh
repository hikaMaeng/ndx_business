#!/usr/bin/env bash
set -uo pipefail

# Pull the declared Node window forward.
#
# A version range only ever tightens on its own: nothing notices when the
# reason for an exclusion disappears upstream, and the project quietly ages on
# a pin nobody revisits. This script is the counterweight.
#
#   scripts/check-node-support.sh                 list releases the range excludes
#   scripts/check-node-support.sh --node <path>   prove one binary works, or not
#
# Widen engines.node only after the probe passes. Never widen on a changelog.

declared="$(node -p "require('./package.json').engines?.node ?? ''" 2>/dev/null)"
if [[ -z "$declared" ]]; then
  echo "root package.json declares no engines.node" >&2
  exit 2
fi

candidate=""
if [[ "${1:-}" == "--node" ]]; then
  candidate="${2:-}"
  if [[ -z "$candidate" || ! -x "$candidate" ]]; then
    echo "--node needs a path to a node binary" >&2
    exit 2
  fi
fi

# ------------------------------------------------------------------ probe ----

if [[ -n "$candidate" ]]; then
  version="$("$candidate" -p 'process.versions.node' 2>/dev/null)"
  if [[ -z "$version" ]]; then
    echo "check name=probe status=violation detail=not-a-node-binary: $candidate"
    exit 1
  fi

  if node scripts/node-range.mjs "$declared" "$version"; then
    echo "check name=probe status=ok detail=v$version already inside \"$declared\""
    exit 0
  fi

  # Run the real toolchain under the candidate. The failure this guards against
  # happens while loading a package, so only a real build proves anything.
  export PATH="$(cd "$(dirname "$candidate")" && pwd):$PATH"
  probe_log="$(npm install 2>&1 && npm exec -- turbo run build 2>&1)"
  probe_status=$?

  if [[ "$probe_status" -eq 0 ]]; then
    echo "check name=probe status=ok detail=v$version builds cleanly and is outside \"$declared\""
    echo "widen engines.node in the root and app manifests to admit v$version, then re-run"
    echo "scripts/check-baseline.sh and commit the range change with this evidence."
  else
    echo "check name=probe status=violation detail=v$version still fails the build"
    printf '%s\n' "$probe_log" | grep -E 'Error|error|EBADF' | head -5
  fi
  exit "$probe_status"
fi

# --------------------------------------------------------------- listing ----

# Ask nodejs.org which releases exist, then report the ones the range rejects.
excluded="$(node -e '
const https = require("node:https");
const range = process.argv[1];
https.get("https://nodejs.org/dist/index.json", (res) => {
  let raw = "";
  res.on("data", (chunk) => (raw += chunk));
  res.on("end", async () => {
    const { satisfies } = await import("./scripts/node-range.mjs");
    const newestPerLine = new Map();
    for (const release of JSON.parse(raw)) {
      const version = release.version.replace(/^v/, "");
      const major = version.split(".")[0];
      if (!newestPerLine.has(major)) {
        newestPerLine.set(major, { version, date: release.date, lts: release.lts || "" });
      }
    }
    for (const [major, info] of [...newestPerLine].sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 4)) {
      const verdict = satisfies(range, info.version) ? "allowed" : "excluded";
      const line = info.lts ? `LTS ${info.lts}` : "Current";
      console.log(`${verdict}\tv${major}\tv${info.version}\t${info.date}\t${line}`);
    }
  });
}).on("error", (error) => {
  console.error("offline: " + error.code);
  process.exit(3);
});
' "$declared" 2>&1)"

if [[ $? -eq 3 || -z "$excluded" ]]; then
  echo "check name=listing status=skipped detail=could not reach nodejs.org"
  exit 0
fi

# The runtime image tracks LTS, which means its base major has an expiry date
# nobody remembers. Report it against the official schedule.
node -e '
const https = require("node:https");
const base = process.argv[1];
if (!base) process.exit(0);
https.get(
  "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json",
  { headers: { "user-agent": "node" } },
  (res) => {
    let raw = "";
    res.on("data", (chunk) => (raw += chunk));
    res.on("end", () => {
      let schedule;
      try {
        schedule = JSON.parse(raw);
      } catch {
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const current = schedule[`v${base}`];
      if (!current) return;
      console.log(`runtime image base: node ${base}`);
      if (current.end && today >= current.end) {
        console.log(`  end-of-life since ${current.end} - move the base image now`);
      } else if (current.maintenance && today >= current.maintenance) {
        console.log(`  in maintenance since ${current.maintenance}, end-of-life ${current.end}`);
      } else if (!current.lts) {
        console.log(`  odd-numbered line - never becomes LTS, end-of-life ${current.end || "?"}`);
      } else if (today < current.lts) {
        console.log(`  Current, becomes LTS on ${current.lts}, end-of-life ${current.end || "?"}`);
      } else {
        console.log(`  active LTS until ${current.maintenance || "?"}, end-of-life ${current.end || "?"}`);
      }
      const successor = Object.entries(schedule)
        .filter(([line, info]) => Number(line.slice(1)) > Number(base) && info.lts)
        .sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))[0];
      if (successor) {
        const [line, info] = successor;
        const verb = today >= info.lts ? "is already LTS since" : "becomes LTS on";
        console.log(`  successor ${line} ${verb} ${info.lts} - plan the base image move`);
      }
      console.log("");
    });
  }
).on("error", () => {});
' "$(grep -hoE "^FROM +node:([0-9]+)" apps/*/docker/Dockerfile 2>/dev/null | grep -oE '[0-9]+' | sort -u | head -1)"

echo "declared: $declared"
echo
printf '%s\n' "$excluded" | while IFS=$'\t' read -r verdict major version date line; do
  printf '  %-8s %-5s %-10s %s  %s\n' "$verdict" "$major" "$version" "$date" "$line"
done
echo
if printf '%s\n' "$excluded" | grep -q '^excluded'; then
  echo "Some current releases are excluded. Prove one before widening the range:"
  echo "  scripts/check-node-support.sh --node /path/to/node"
else
  echo "Every current release line is already admitted."
fi
