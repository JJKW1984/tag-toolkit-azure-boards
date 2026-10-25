#!/usr/bin/env bash
set -euo pipefail

# Resolves the branch name a workflow run targets: the PR base branch if
# this is a pull_request event, otherwise the ref name (push or
# workflow_dispatch).
resolve_target() {
  local base_ref="$1"
  local ref_name="$2"
  if [[ -n "$base_ref" ]]; then
    echo "$base_ref"
  else
    echo "$ref_name"
  fi
}

# Emits the manifest/extension-id/path GITHUB_OUTPUT lines for a given
# resolved target branch.
resolve_outputs() {
  local target="$1"
  if [[ "$target" == "main" ]]; then
    echo "extension-id=tag-toolkit-azure-boards"
    echo "manifest-file=vss-extension.json"
    echo "path=publish"
  else
    echo "extension-id=tag-toolkit-azure-boards-develop"
    echo "manifest-file=vss-extension-dev.json"
    echo "path=share"
  fi
}

# Only run as a script (not when sourced for testing).
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  base_ref="${1:-}"
  ref_name="${2:-}"
  target="$(resolve_target "$base_ref" "$ref_name")"
  resolve_outputs "$target" >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT not set}"
fi
