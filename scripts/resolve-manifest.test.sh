#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/resolve-manifest.sh"

failures=0

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: $desc"
    echo "  expected: $expected"
    echo "  actual:   $actual"
    failures=$((failures + 1))
  else
    echo "PASS: $desc"
  fi
}

# resolve_target: PR event uses base_ref over ref_name
assert_eq "resolve_target prefers base_ref" "main" "$(resolve_target "main" "some-feature-branch")"

# resolve_target: push/dispatch event has empty base_ref, falls back to ref_name
assert_eq "resolve_target falls back to ref_name" "dev" "$(resolve_target "" "dev")"

# resolve_outputs: main -> publish path
main_outputs="$(resolve_outputs "main")"
assert_eq "main extension-id" "extension-id=tag-toolkit-azure-boards" "$(echo "$main_outputs" | sed -n '1p')"
assert_eq "main manifest-file" "manifest-file=vss-extension.json" "$(echo "$main_outputs" | sed -n '2p')"
assert_eq "main path" "path=publish" "$(echo "$main_outputs" | sed -n '3p')"

# resolve_outputs: dev -> share path
dev_outputs="$(resolve_outputs "dev")"
assert_eq "dev extension-id" "extension-id=tag-toolkit-azure-boards-develop" "$(echo "$dev_outputs" | sed -n '1p')"
assert_eq "dev manifest-file" "manifest-file=vss-extension-dev.json" "$(echo "$dev_outputs" | sed -n '2p')"
assert_eq "dev path" "path=share" "$(echo "$dev_outputs" | sed -n '3p')"

# resolve_outputs: any other branch -> share path (same as dev)
feature_outputs="$(resolve_outputs "some-feature-branch")"
assert_eq "feature extension-id" "extension-id=tag-toolkit-azure-boards-develop" "$(echo "$feature_outputs" | sed -n '1p')"
assert_eq "feature path" "path=share" "$(echo "$feature_outputs" | sed -n '3p')"

if [[ "$failures" -gt 0 ]]; then
  echo "$failures assertion(s) failed"
  exit 1
fi

echo "All assertions passed"
