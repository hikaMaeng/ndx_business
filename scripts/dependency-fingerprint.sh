#!/usr/bin/env bash
set -uo pipefail

# Hash of everything that decides what should be installed.
#
# The deploy entrypoint writes this into the install marker and compares it on
# the next run; the scaffold installer writes it once so a freshly copied
# project starts already up to date. Both must agree on the definition, which
# is why it lives here instead of being spelled out twice.

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

{
  printf 'deploy-install-v2\n'
  find package.json package-lock.json apps packages \
    \( -name package.json -o -name package-lock.json \) \
    -not -path '*/node_modules/*' \
    -type f -print 2>/dev/null | sort | while IFS= read -r path; do
      sha256_of "$path"
    done
} | sha256_of | awk '{print $1}'
