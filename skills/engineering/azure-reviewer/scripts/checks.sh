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
#   checks.sh <REPO_NAME> <SOURCE_SHA> [--workspace <dir>] [--full] [--changed <file> ...]
#
# Locating the repo clone (build/lint needs a local checkout to reuse node_modules):
#   1. --workspace <dir>       explicit; searched first (dir itself + its children)
#   2. $ADO_REVIEW_WORKSPACE   same, via environment
#   3. walk up from $PWD       so running the review from inside the repo just works
#   4. children of $PWD        so running it from a folder that holds several clones works
#   5. a 4-levels-up heuristic from this script (legacy workspace/<repo> layout)
# The first git clone whose `origin` remote ends with /_git/<REPO_NAME> wins.
# Not tied to any particular workspace layout; if none is found the gate degrades to
# GATE: SKIPPED (exit 0) — never a hard failure.
#
# Output: a plain-text report on stdout, plus a final "GATE: PASS|FAIL|SKIPPED"
# line the caller keys on. Non-zero exit ONLY on a real check failure.
#
set -uo pipefail

REPO_NAME="${1:?REPO_NAME required}"; shift
SOURCE_SHA="${1:?SOURCE_SHA required}"; shift
FULL=0; CHANGED=(); WORKSPACE="${ADO_REVIEW_WORKSPACE:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --full) FULL=1; shift;;
    --workspace) shift; WORKSPACE="${1:-}"; shift || true;;
    --changed) shift; while [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; do CHANGED+=("$1"); shift; done;;
    *) shift;;
  esac
done

log() { printf '%s\n' "$*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Does <dir> hold a git clone whose origin remote is REPO_NAME? Print it and succeed if so.
_is_match() {
  local d="$1" url
  { [ -d "$d/.git" ] || [ -f "$d/.git" ]; } || return 1
  url="$(git -C "$d" remote get-url origin 2>/dev/null || true)"
  case "$url" in
    */_git/"$REPO_NAME"|*/_git/"$REPO_NAME".git) printf '%s' "$d"; return 0;;
  esac
  return 1
}
# Match <root> itself, then each immediate child.
_search_root() {
  local root="$1" d
  [ -n "$root" ] && [ -d "$root" ] || return 1
  _is_match "$root" && return 0
  for d in "$root"/*/; do
    [ -d "$d" ] || continue
    _is_match "${d%/}" && return 0
  done
  return 1
}
# Walk up from <dir> to the filesystem root, matching at each level.
_walk_up() {
  local d="$1"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    _is_match "$d" && return 0
    d="$(dirname "$d")"
  done
  return 1
}

# --- locate the clone, in priority order ---
CLONE=""
[ -n "$CLONE" ] || CLONE="$(_search_root "$WORKSPACE" || true)"
[ -n "$CLONE" ] || CLONE="$(_walk_up "$PWD" || true)"
[ -n "$CLONE" ] || CLONE="$(_search_root "$PWD" || true)"
[ -n "$CLONE" ] || CLONE="$(_search_root "$(cd "$SCRIPT_DIR/../../../.." 2>/dev/null && pwd)" || true)"

if [ -z "$CLONE" ]; then
  log "No local clone of '$REPO_NAME' found (looked in --workspace/\$ADO_REVIEW_WORKSPACE, \$PWD and its parents, and near the script)."
  log "Pass --workspace <dir> to point at the folder that holds the clone. Build/lint gate skipped."
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
