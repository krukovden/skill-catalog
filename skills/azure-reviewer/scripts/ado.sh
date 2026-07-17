#!/usr/bin/env bash
#
# ado.sh — deterministic Azure DevOps mechanics for the azure-reviewer skill.
#
# All the non-judgement parts of a PR review (preflight, fetching, posting) live
# here so they run identically every time instead of being re-improvised as bash.
# The LLM calls these subcommands and only does the reviewing.
#
# Portability: relies ONLY on `az` (a hard dependency of the skill). Field
# extraction uses `az --query` (JMESPath) + `-o tsv/json`, so NO jq / python is
# required — works in Git Bash on Windows and in bash/zsh on macOS/Linux.
#
# Windows/Git Bash: every `az devops invoke` is prefixed with MSYS_NO_PATHCONV=1
# so `/paths` are not mangled into `C:/Program Files/Git/...`.
#
# Usage:
#   ado.sh preflight
#   ado.sh pr        <PR_ID>
#   ado.sh iteration <REPO_ID> <PR_ID>          # latest iteration id
#   ado.sh changes   <REPO_ID> <PR_ID> <ITER>   # TSV: changeType<TAB>path
#   ado.sh file      <REPO_ID> <PATH> <SHA> [OUTFILE]
#   ado.sh threads   <REPO_ID> <PR_ID>          # existing threads (dedup): path<TAB>line  (one row per thread)
#   ado.sh post      <REPO_ID> <PR_ID> <THREAD_JSON_FILE>
#   ado.sh anchor    <FINDINGS_TSV> <REPO_ID> <SOURCE_SHA>   # verify each finding's quoted line == real line content
#   ado.sh verify-posted <FINDINGS_TSV> <REPO_ID> <PR_ID>    # confirm each approved finding now has a thread
#
# FINDINGS_TSV format (one finding per line, tab-separated; '#'-prefixed lines ignored):
#   id <TAB> tag <TAB> file <TAB> line <TAB> quotedLine
# e.g.  3<TAB>N<TAB>/backend/src/x.ts<TAB>60<TAB>throw new Error('... aborting retry');
#
set -euo pipefail

err()  { printf '%s\n' "$*" >&2; }
die()  { err "ERROR: $*"; exit 1; }

# Resolve the configured default project (needed as a route-param for `az devops invoke`).
_default_project() {
  az devops configure --list 2>/dev/null \
    | awk -F'=' '/^[[:space:]]*project[[:space:]]*=/{gsub(/^[[:space:]]+|[[:space:]]+$/,"",$2); print $2}'
}
_default_org() {
  az devops configure --list 2>/dev/null \
    | awk -F'=' '/^[[:space:]]*organization[[:space:]]*=/{gsub(/^[[:space:]]+|[[:space:]]+$/,"",$2); print $2}'
}

cmd_preflight() {
  local ok=1
  # 0a — auth
  if az account show -o none 2>/dev/null; then
    err "0a login       OK ($(az account show --query user.name -o tsv 2>/dev/null))"
  else
    err "0a login       MISSING  -> run: az login   (or: az login --use-device-code)"
    ok=0
  fi
  # 0b — devops extension
  if az extension show --name azure-devops -o none 2>/dev/null; then
    err "0b extension    OK"
  else
    err "0b extension    MISSING  -> run: az extension add --name azure-devops"
    ok=0
  fi
  # 0c — org/project defaults
  local org proj; org="$(_default_org)"; proj="$(_default_project)"
  if [ -n "$org" ] && [ -n "$proj" ]; then
    err "0c org/project  OK ($org / $proj)"
  else
    err "0c org/project  MISSING  -> ASK the user, then: az devops configure --defaults organization=<URL> project=<NAME>"
    ok=0
  fi
  [ "$ok" -eq 1 ] || { err ""; err "Preflight FAILED — resolve the MISSING items above before reviewing."; return 1; }
  err ""; err "Preflight OK."
}

cmd_pr() {
  local pr="${1:?PR_ID required}"
  # One JSON object with everything Step 1 needs.
  az repos pr show --id "$pr" --output json \
    --query "{repoId:repository.id, repo:repository.name, title:title, status:status, isDraft:isDraft, author:createdBy.displayName, sourceBranch:sourceRefName, targetBranch:targetRefName, sourceSha:lastMergeSourceCommit.commitId, targetSha:lastMergeTargetCommit.commitId, description:description}"
}

cmd_iteration() {
  local repo="${1:?REPO_ID}" pr="${2:?PR_ID}" proj; proj="$(_default_project)"
  [ -n "$proj" ] || die "no default project — run preflight"
  MSYS_NO_PATHCONV=1 az devops invoke \
    --area git --resource pullRequestIterations \
    --route-parameters project="$proj" repositoryId="$repo" pullRequestId="$pr" \
    --output json --query "max(value[].id)" -o tsv
}

cmd_changes() {
  local repo="${1:?REPO_ID}" pr="${2:?PR_ID}" iter="${3:?ITER}" proj; proj="$(_default_project)"
  [ -n "$proj" ] || die "no default project — run preflight"
  # TSV: changeType <TAB> path  (skip binaries downstream)
  MSYS_NO_PATHCONV=1 az devops invoke \
    --area git --resource pullRequestIterationChanges \
    --route-parameters project="$proj" repositoryId="$repo" pullRequestId="$pr" iterationId="$iter" \
    --output json --query "changeEntries[].[changeType, item.path]" -o tsv
}

cmd_file() {
  local repo="${1:?REPO_ID}" path="${2:?PATH}" sha="${3:?SHA}" out="${4:-}" proj; proj="$(_default_project)"
  [ -n "$proj" ] || die "no default project — run preflight"
  if [ -n "$out" ]; then
    MSYS_NO_PATHCONV=1 az devops invoke \
      --area git --resource items \
      --route-parameters project="$proj" repositoryId="$repo" \
      --query-parameters "path=$path" "versionDescriptor.version=$sha" "versionDescriptor.versionType=commit" "includeContent=true" \
      --output json --query "content" -o tsv > "$out"
  else
    MSYS_NO_PATHCONV=1 az devops invoke \
      --area git --resource items \
      --route-parameters project="$proj" repositoryId="$repo" \
      --query-parameters "path=$path" "versionDescriptor.version=$sha" "versionDescriptor.versionType=commit" "includeContent=true" \
      --output json --query "content" -o tsv
  fi
}

cmd_threads() {
  local repo="${1:?REPO_ID}" pr="${2:?PR_ID}" proj; proj="$(_default_project)"
  [ -n "$proj" ] || die "no default project — run preflight"
  # For idempotency/dedup: existing threads that anchor to a file location.
  # TSV: path <TAB> line  (one clean row per thread — comment text omitted on purpose,
  # since comment bodies contain newlines and would break the TSV contract).
  MSYS_NO_PATHCONV=1 az devops invoke \
    --area git --resource pullRequestThreads \
    --route-parameters project="$proj" repositoryId="$repo" pullRequestId="$pr" \
    --api-version 7.1 --output json \
    --query "value[?threadContext.filePath!=null].[threadContext.filePath, threadContext.rightFileStart.line]" -o tsv
}

cmd_post() {
  local repo="${1:?REPO_ID}" pr="${2:?PR_ID}" json="${3:?THREAD_JSON_FILE}" proj; proj="$(_default_project)"
  [ -n "$proj" ] || die "no default project — run preflight"
  [ -f "$json" ] || die "thread json not found: $json"
  MSYS_NO_PATHCONV=1 az devops invoke \
    --area git --resource pullRequestThreads \
    --route-parameters project="$proj" repositoryId="$repo" pullRequestId="$pr" \
    --http-method POST --in-file "$json" --api-version 7.1 \
    --output json --query "{id:id, status:status}"
}

# --- trim leading/trailing whitespace (portable) ---
_trim() { printf '%s' "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }
# --- ensure a repo path has a leading slash (ADO paths are rooted) ---
_slash() { case "$1" in /*) printf '%s' "$1";; *) printf '/%s' "$1";; esac; }

# #1 ANCHOR-CHECK: each finding's quotedLine must match the real content at file:line.
# Catches drifted anchors (a comment that would attach to the wrong line).
cmd_anchor() {
  local tsv="${1:?FINDINGS_TSV}" repo="${2:?REPO_ID}" sha="${3:?SOURCE_SHA}"
  [ -f "$tsv" ] || die "findings tsv not found: $tsv"
  local cache rc=0; cache="$(mktemp -d)"
  local id tag file line quoted safe cf actual a q
  while IFS=$'\t' read -r id tag file line quoted || [ -n "${id:-}" ]; do
    [ -n "${id:-}" ] || continue
    case "$id" in \#*) continue;; esac
    file="$(_slash "$file")"
    safe="$(printf '%s' "$file" | sed 's#[/.]#_#g')"; cf="$cache/$safe"
    [ -f "$cf" ] || cmd_file "$repo" "$file" "$sha" "$cf"
    actual="$(sed -n "${line}p" "$cf")"
    a="$(_trim "$actual")"; q="$(_trim "$quoted")"
    if [ -n "$q" ] && { [ "$a" = "$q" ] || printf '%s\n' "$a" | grep -qF -- "$q"; }; then
      printf 'PASS    #%s  %s:%s\n' "$id" "$file" "$line"
    else
      printf 'REJECT  #%s  %s:%s  anchor-mismatch\n         line %s is : "%s"\n         quoted    : "%s"\n' \
        "$id" "$file" "$line" "$line" "$actual" "$quoted"
      rc=1
    fi
  done < "$tsv"
  rm -rf "$cache"
  [ "$rc" -eq 0 ] && err "ANCHORS OK" || err "ANCHOR CHECK FAILED — fix line numbers / quotes above before posting."
  return $rc
}

# #3 POST-VERIFY: after posting, confirm every approved finding now has a thread at its file:line.
# Closes the loop — proves the comment actually landed instead of assuming it did.
cmd_verify_posted() {
  local tsv="${1:?FINDINGS_TSV}" repo="${2:?REPO_ID}" pr="${3:?PR_ID}"
  [ -f "$tsv" ] || die "findings tsv not found: $tsv"
  local threads rc=0; threads="$(cmd_threads "$repo" "$pr")"
  local id tag file line quoted
  while IFS=$'\t' read -r id tag file line quoted || [ -n "${id:-}" ]; do
    [ -n "${id:-}" ] || continue
    case "$id" in \#*) continue;; esac
    file="$(_slash "$file")"
    if printf '%s\n' "$threads" | awk -F'\t' -v f="$file" -v l="$line" '$1==f && $2==l{ok=1} END{exit ok?0:1}'; then
      printf 'POSTED   #%s  %s:%s\n' "$id" "$file" "$line"
    else
      printf 'MISSING  #%s  %s:%s  (no thread found at this location)\n' "$id" "$file" "$line"; rc=1
    fi
  done < "$tsv"
  [ "$rc" -eq 0 ] && err "ALL POSTED OK" || err "POST-VERIFY FAILED — some approved comments did not land; re-post the MISSING ones."
  return $rc
}

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    preflight) cmd_preflight "$@";;
    pr)        cmd_pr "$@";;
    iteration) cmd_iteration "$@";;
    changes)   cmd_changes "$@";;
    file)      cmd_file "$@";;
    threads)   cmd_threads "$@";;
    post)      cmd_post "$@";;
    anchor)         cmd_anchor "$@";;
    verify-posted)  cmd_verify_posted "$@";;
    ""|-h|--help)
      grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) die "unknown subcommand: $sub (see: ado.sh --help)";;
  esac
}
main "$@"
