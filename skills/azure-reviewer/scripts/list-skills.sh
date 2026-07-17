#!/usr/bin/env bash
#
# list-skills.sh — enumerate the review skills available on THIS machine so azure-reviewer
# can reuse a stack-specific skill (Angular / React / C# / Node / pipelines / security …)
# instead of falling back to general expertise. It scans the standard Claude skill
# locations; matching a skill to the PR's stack is left to the caller (read the
# description, decide). Portable: pure bash, no jq/python.
#
# Scanned locations (both, in this order):
#   - project-local:  <cwd>/.claude/skills/*/SKILL.md      (override with $1)
#   - user-global:    ~/.claude/skills/*/SKILL.md
#
# Output TSV, one skill per line:
#   scope <TAB> name <TAB> path <TAB> description(first line, truncated)
#   scope = project | global
#
# Exit 0 always (an empty list is a valid answer — just means "no local skills, use
# built-in expertise").
#
set -uo pipefail

# First line of the frontmatter `description:` — handles inline values and YAML block
# scalars (`>`, `>-`, `|`, `|-`). Best-effort; only used as a matching hint.
_desc() {
  awk '
    /^description:[[:space:]]*/ {
      line = $0
      sub(/^description:[[:space:]]*/, "", line)
      sub(/^[>|][+-]?[[:space:]]*/, "", line)   # strip a block-scalar indicator
      if (line != "") { print line; exit }
      inblock = 1; next
    }
    inblock {
      sub(/^[[:space:]]+/, "", $0)
      if ($0 != "") { print $0; exit }
    }
  ' "$1" 2>/dev/null
}

emit_dir() { # <scope> <skills_dir>
  local scope="$1" root="$2" d name desc
  [ -d "$root" ] || return 0
  for d in "$root"/*/; do
    [ -f "${d}SKILL.md" ] || continue
    name="$(basename "$d")"
    desc="$(_desc "${d}SKILL.md")"
    # strip a surrounding quote pair left by a quoted YAML scalar
    case "$desc" in
      \"*\") desc="${desc#\"}"; desc="${desc%\"}";;
      \'*\') desc="${desc#\'}"; desc="${desc%\'}";;
    esac
    # truncate description to keep the TSV compact
    [ "${#desc}" -gt 160 ] && desc="${desc:0:157}..."
    printf '%s\t%s\t%s\t%s\n' "$scope" "$name" "${d%/}" "${desc:-}"
  done
}

PROJECT_SKILLS="${1:-$PWD/.claude/skills}"
GLOBAL_SKILLS="${HOME:-$HOME}/.claude/skills"

emit_dir project "$PROJECT_SKILLS"
emit_dir global  "$GLOBAL_SKILLS"
