#!/usr/bin/env bash
#
# checks.sh — objective build/lint gate for the azure-reviewer skill (part C).
#
# Turns "I think it compiles" into evidence: checks out the PR branch in an
# ISOLATED git worktree (never touches the user's working tree) and runs the
# repo's typecheck / lint (fast, default) or full build / test (--full),
# scoping type-check output to the files the PR actually changed.
#
# Deterministic & side-effect free:
#   - operates in a throwaway worktree under TMPDIR, removed on exit
#   - symlinks node_modules from the existing local clone (no install)
#   - never mutates the local checkout or the current branch
#   - degrades gracefully: if no local clone is found, prints ran=false and exits 0
#
# Usage:
#   checks.sh <REPO_NAME> <SOURCE_SHA> [--full] [--changed <file> ...]
#
# Output: a plain-text report on stdout, plus a final "GATE: PASS|FAIL|SKIPPED"
# line the caller keys on. Non-zero exit ONLY on a real check failure.
#
set -uo pipefail

REPO_NAME="${1:?REPO_NAME required}"; shift
SOURCE_SHA="${1:?SOURCE_SHA required}"; shift
FULL=0; CHANGED=()
while [ $# -gt 0 ]; do
  case "$1" in
    --full) FULL=1; shift;;
    --changed) shift; while [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; do CHANGED+=("$1"); shift; done;;
    *) shift;;
  esac
done

log() { printf '%s\n' "$*"; }

# Workspace root = the directory that contains this skill's .claude tree.
# scripts/ -> azure-reviewer/ -> skills/ -> .claude/ -> <workspace root>
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

# --- locate the local clone by matching git remote to /_git/<REPO_NAME> ---
CLONE=""
for d in "$WS_ROOT"/*/; do
  [ -d "$d/.git" ] || continue
  url="$(git -C "$d" remote get-url origin 2>/dev/null || true)"
  case "$url" in
    */_git/"$REPO_NAME"|*/_git/"$REPO_NAME".git) CLONE="${d%/}"; break;;
  esac
done

if [ -z "$CLONE" ]; then
  log "No local clone of '$REPO_NAME' found under $WS_ROOT — build/lint gate skipped."
  log "GATE: SKIPPED"
  exit 0
fi
log "Local clone: $CLONE"

# --- fetch the PR commit and add an isolated worktree ---
WT="${TMPDIR:-/tmp}/ado-checks-$REPO_NAME-$$"
cleanup() { git -C "$CLONE" worktree remove "$WT" --force >/dev/null 2>&1 || true; git -C "$CLONE" worktree prune >/dev/null 2>&1 || true; }
trap cleanup EXIT

if ! git -C "$CLONE" fetch origin "$SOURCE_SHA" >/dev/null 2>&1; then
  git -C "$CLONE" fetch origin >/dev/null 2>&1 || true
fi
if ! git -C "$CLONE" worktree add --detach "$WT" "$SOURCE_SHA" >/dev/null 2>&1; then
  log "Could not create worktree at $SOURCE_SHA — gate skipped."
  log "GATE: SKIPPED"; exit 0
fi
log "Worktree: $WT @ ${SOURCE_SHA:0:10}"

FAILED=0

# rel path of a changed file within a given subdir (empty if not under it)
_rel_under() { # <subdir> <path>
  case "$2" in "$1"/*) printf '%s' "${2#"$1"/}";; /"$1"/*) printf '%s' "${2#/"$1"/}";; esac
}

run_node_project() { # <subdir e.g. backend>
  local sub="$1"
  local dir="$WT/$sub"
  local src="$CLONE/$sub"
  [ -f "$dir/package.json" ] || return 0
  # any changed file under this subdir?
  local touched=0 f rel
  for f in "${CHANGED[@]:-}"; do [ -n "$f" ] || continue; rel="$(_rel_under "$sub" "$f")"; [ -n "$rel" ] && touched=1; done
  [ "$touched" -eq 1 ] || { log "· $sub: no changed files, skipped"; return 0; }

  # reuse the clone's node_modules instead of installing (fast, deterministic)
  if [ ! -e "$dir/node_modules" ] && [ -d "$src/node_modules" ]; then
    ln -s "$src/node_modules" "$dir/node_modules"
  fi
  if [ ! -e "$dir/node_modules" ]; then
    log "· $sub: no node_modules in clone — cannot typecheck, skipped"; return 0
  fi

  log ""
  log "=== [$sub] typecheck (tsc --noEmit) — errors scoped to changed files ==="
  local tsconfig="tsconfig.json"; [ -f "$dir/tsconfig.json" ] || tsconfig="tsconfig.build.json"
  local out; out="$(cd "$dir" && npx --no-install tsc --noEmit -p "$tsconfig" 2>&1)"
  # filter to changed files only
  local pat="" hits=""
  for f in "${CHANGED[@]:-}"; do rel="$(_rel_under "$sub" "$f")"; [ -n "$rel" ] && pat="${pat}${pat:+|}$(printf '%s' "$rel" | sed 's/[.[\*^$]/\\&/g')"; done
  if [ -n "$pat" ]; then hits="$(printf '%s\n' "$out" | grep -E "$pat" || true)"; fi
  if [ -n "$hits" ]; then
    log "$hits"; log ">>> TYPECHECK FAIL in $sub (changed files)"; FAILED=1
  else
    log "no type errors in changed files ✓"
  fi

  if [ "$FULL" -eq 1 ]; then
    log ""
    log "=== [$sub] build (npm run build) ==="
    if (cd "$dir" && npm run build >/tmp/ado-build-$$.log 2>&1); then log "build OK ✓"; else log "$(tail -30 /tmp/ado-build-$$.log)"; log ">>> BUILD FAIL in $sub"; FAILED=1; fi
    rm -f /tmp/ado-build-$$.log
  fi

  # eslint on changed files of this subdir
  log ""
  log "=== [$sub] eslint (changed files) ==="
  local files=()
  for f in "${CHANGED[@]:-}"; do rel="$(_rel_under "$sub" "$f")"; case "$rel" in *.ts|*.tsx|*.js) [ -f "$dir/$rel" ] && files+=("$rel");; esac; done
  if [ "${#files[@]}" -gt 0 ]; then
    if (cd "$dir" && npx --no-install eslint "${files[@]}" >/tmp/ado-lint-$$.log 2>&1); then log "eslint clean ✓"; else log "$(cat /tmp/ado-lint-$$.log)"; log ">>> LINT FAIL in $sub"; FAILED=1; fi
    rm -f /tmp/ado-lint-$$.log
  else
    log "no lintable changed files"
  fi
}

run_dotnet_project() {
  # any .csproj/.sln touched or present, and any changed .cs?
  local haschange=0 f
  for f in "${CHANGED[@]:-}"; do case "$f" in *.cs) haschange=1;; esac; done
  [ "$haschange" -eq 1 ] || return 0
  command -v dotnet >/dev/null 2>&1 || { log "· dotnet not installed — .NET gate skipped"; return 0; }
  local sln; sln="$(cd "$WT" && ls *.sln 2>/dev/null | head -1 || true)"
  log ""
  log "=== [.NET] dotnet build ==="
  if (cd "$WT" && dotnet build ${sln:+"$sln"} --nologo -clp:ErrorsOnly >/tmp/ado-dotnet-$$.log 2>&1); then
    log "build OK ✓"
  else
    log "$(tail -40 /tmp/ado-dotnet-$$.log)"; log ">>> DOTNET BUILD FAIL"; FAILED=1
  fi
  rm -f /tmp/ado-dotnet-$$.log
}

# --- detect and run ---
if [ -f "$WT/package.json" ] || [ -d "$WT/backend" ] || [ -d "$WT/frontend" ]; then
  run_node_project backend
  run_node_project frontend
fi
if ls "$WT"/*.sln >/dev/null 2>&1 || find "$WT" -maxdepth 2 -name '*.csproj' 2>/dev/null | grep -q .; then
  run_dotnet_project
fi

log ""
if [ "$FAILED" -eq 1 ]; then log "GATE: FAIL"; exit 1; else log "GATE: PASS"; exit 0; fi
