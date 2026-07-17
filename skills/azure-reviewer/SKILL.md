---
name: azure-reviewer
description: Review Azure DevOps pull requests via az CLI — fetch PR diff, analyze code, present issues, and post approved comments back to the PR. Use when the user asks to review an Azure DevOps PR, mentions a PR ID/URL, or wants to post review comments to Azure DevOps.
---

# Skill: azure-reviewer

## Role
You review Azure DevOps pull requests by fetching the diff via `az` CLI, analyzing the code against team standards, and posting user-approved comments back to the PR.

## Prerequisites
- `az login` completed (check with `az account show`)
- Azure DevOps extension installed (`az extension add --name azure-devops`)
- Default org/project configured (`az devops configure --defaults organization=<URL> project=<NAME>`) or passed explicitly

**These are not assumed — Step 0 below verifies and, if missing, sets them up interactively.** This makes the skill portable: on a fresh machine nothing is pre-configured, so Step 0 walks the user through login, extension install, and org/project defaults before any PR work begins.

## Helper scripts (use these — do NOT hand-write `az` bash)

Two committed scripts live next to this file under `scripts/`. They make the mechanical parts of a review **deterministic** — the same commands run identically every time instead of being re-improvised as bash. Call them by absolute path; the skill's base directory is shown when the skill loads (`<SKILL_DIR>/scripts/...`).

- **`ado.sh`** — all Azure DevOps I/O. Portable (uses only `az`, no jq/python). Subcommands:
  - `preflight` — checks login + extension + org/project (Step 0); exits non-zero and prints what's missing.
  - `pr <PR_ID>` — one JSON object: `repoId, repo, title, status, isDraft, author, sourceBranch, targetBranch, sourceSha, targetSha, description`.
  - `iteration <REPO_ID> <PR_ID>` — latest iteration id.
  - `changes <REPO_ID> <PR_ID> <ITER>` — TSV `changeType<TAB>path` of changed files.
  - `file <REPO_ID> <PATH> <SHA> [OUTFILE]` — file content at a commit.
  - `threads <REPO_ID> <PR_ID>` — existing comment threads (TSV `path<TAB>line`, one row each) for **dedup**.
  - `post <REPO_ID> <PR_ID> <THREAD_JSON_FILE>` — post one comment thread.
  - `anchor <FINDINGS_TSV> <REPO_ID> <SOURCE_SHA>` — **validate anchors**: each finding's quoted line must match the real content at `file:line`; prints `PASS`/`REJECT` and exits non-zero on any mismatch.
  - `verify-posted <FINDINGS_TSV> <REPO_ID> <PR_ID>` — **close the loop**: confirm each approved finding now has a thread at its `file:line`; prints `POSTED`/`MISSING`, non-zero if any missing.

  Both validators read one **findings TSV** (one finding per line, tab-separated, `#`-comments ignored):
  ```
  id <TAB> tag <TAB> file <TAB> line <TAB> quotedLine
  ```
  Maintain this TSV as you analyze — it is the machine-checkable mirror of your findings table.
- **`checks.sh`** — objective **build/lint gate** (Step 4b). Checks out the PR commit in an isolated throwaway worktree, symlinks the local clone's `node_modules`, runs `tsc --noEmit` (scoped to changed files) + `eslint` on changed files, or `--full` for build/test; `.cs` repos get `dotnet build`. Prints a final `GATE: PASS|FAIL|SKIPPED`. Finds the clone via `--workspace`/`$ADO_REVIEW_WORKSPACE`/`$PWD`; degrades to `SKIPPED` (exit 0) if none. Never mutates the user's working tree.
- **`list-skills.sh`** — discover the review skills installed on this machine — project-local (`.claude/skills`), user-global (`~/.claude/skills`), and active plugins (via `installed_plugins.json`) — so Step 3 can reuse a stack-specific skill. TSV: `scope<TAB>name<TAB>path<TAB>description` (scope = project|global|plugin).

**Rule:** route every `az` call and every build/typecheck through these scripts. Only hand-write a one-off `az` command if a script genuinely lacks the capability — then consider adding it to `ado.sh`.

## Windows / Git Bash Compatibility

`ado.sh` already bakes in the tricky parts (rules 1–3, 5 below) so you don't have to think about them. They are documented here only in case you must hand-write a one-off `az` command:

1. **Prefix** with `MSYS_NO_PATHCONV=1` — Git Bash on Windows converts `/paths` to `C:/Program Files/Git/paths`. *(ado.sh does this.)*
2. **Add** `"includeContent=true"` to query-parameters when fetching file content. *(ado.sh does this.)*
3. **Use commit SHA** (from `sourceSha`/`targetSha`) instead of branch name — branches may be deleted. *(ado.sh returns these.)*
4. **Temp files you write yourself** (the comment JSON): `${TMPDIR:-/tmp}/…` on macOS/Linux, `$USERPROFILE/…` on Windows — this one is still on you.
5. **Post via `--api-version 7.1` + `pullRequestThreads`**. *(ado.sh post does this.)*

## Severity Levels

Every observation gets exactly one tag:

| Tag | Meaning | Blocks merge? | Criteria |
|-----|---------|---------------|----------|
| **[B] Blocking** | Must fix before merge | Yes | Bugs, security issues, data loss risk, broken functionality |
| **[S] Suggest** | Should fix, won't block | No | Better approaches, missing edge cases, maintainability |
| **[N] Nit** | Optional improvement | No | Style preferences, minor naming, formatting |
| **[P] Praise** | Good work worth calling out | No | Clever solutions, thorough testing, clean abstractions |

**Rules:**
- Formatting and naming are almost never Blocking — reserve [B] for bugs, security, and data integrity
- **[B] requires High confidence** — a real-but-uncertain concern is [S]/[N] with the uncertainty stated (see Step 5c). A false blocker costs more trust than a missed nit.
- An edge case that actually crashes/corrupts is a **bug ([B])**, not a "missing edge case ([S])" — classify by impact, not by wording.
- Include at least one [P] per review — only pointing out problems is demoralizing
- **Read widely, comment narrowly:** read whatever unchanged code you need to understand the change, but only *post comments* on lines the PR changed — pre-existing issues go to the user as context or a separate issue.

## Workflow

### Step 0: Preflight — auth, extension, and org/project (RUN FIRST, EVERY TIME)

Never assume the environment is configured — a copied skill carries none of this state (`az` login lives in `~/.azure/`, org/project in `~/.azure/azuredevops/config`, neither travels with `SKILL.md`). Run:

```bash
<SKILL_DIR>/scripts/ado.sh preflight
```

It checks all three (0a login, 0b azure-devops extension, 0c org/project defaults) and, on failure, prints exactly which are missing and the command to fix each. Then:

- **Login missing** → tell the user to run `az login` (or `az login --use-device-code` on a headless/remote box). **STOP and wait** — you cannot log in for them.
- **Extension missing** → run `az extension add --name azure-devops`.
- **Org/project missing** → if they were passed in the command arguments, set them with `az devops configure --defaults organization=<URL> project=<NAME>`; otherwise **ASK the user** (do not guess), then set them.

Re-run `ado.sh preflight` until it prints `Preflight OK.` before moving to Step 1.

### Step 1: Fetch PR context + iterations

```bash
<SKILL_DIR>/scripts/ado.sh pr <PR_ID>                       # JSON: repoId, sourceSha, targetSha, title, author, ...
<SKILL_DIR>/scripts/ado.sh iteration <REPO_ID> <PR_ID>      # latest iteration id (uses repoId from above)
```

`ado.sh pr` returns everything Step 1 needs in one object — repository ID, author, source/target branches, and the **source/target commit SHAs** (already resolved from `lastMergeSourceCommit`/`lastMergeTargetCommit`).

Read the PR description to understand **what** and **why** before looking at code. Assess PR size:

| Size | Files | Lines | Approach |
|------|-------|-------|----------|
| Small | 1–5 | <100 | Read every line |
| Medium | 5–15 | 100–500 | Focus on logic changes, skim config |
| Large | 15–30 | 500–1000 | Review by commit, focus on critical files, flag if should be split |
| XL | 30+ | 1000+ | Flag for splitting. Review only highest-risk files |

### Step 2: Fetch changed files

```bash
<SKILL_DIR>/scripts/ado.sh changes <REPO_ID> <PR_ID> <ITER_ID>   # TSV: changeType<TAB>path
```

Keep this list — it is the **scope** of the review (Step 4b gate and the "don't comment on unchanged code" rule both key off it).

### Step 3: Detect the stack and reuse matching review skills (discover what's on the machine)

The diff can span several stacks (C#, Node/TypeScript, Angular, React, pipelines…). Rather than assume named skills exist, **discover the review skills actually installed on this machine — project-local and user-global — and reuse the ones that match the diff's stack.** This skill has **no hard dependency** on any other skill; a specialized skill only sharpens the review when present, and its absence just means you review with your own expertise (still backed by the objective gate in Step 4b).

**1. Discover** what's available — scans project-local (`<cwd>/.claude/skills`), user-global (`~/.claude/skills`), and the active installed **plugins** (resolved from `~/.claude/plugins/installed_plugins.json`):

```bash
<SKILL_DIR>/scripts/list-skills.sh          # TSV: scope <TAB> name <TAB> path <TAB> description   (scope = project|global|plugin)
```

Also consider skills the session already exposes to you via the Skill tool — same set, already registered by the runtime.

**2. Match** the changed files to a skill by reading the `description` column / the skill's stated purpose. Typical stack → skill intent:

| Files in the diff | Reuse a skill whose purpose is… |
|-------------------|--------------------------------|
| Angular (`*.component.ts`, `*.html`, `*.scss`) | Angular / frontend review |
| Node/TypeScript backend (`*.controller.ts`, `*.service.ts`, `*.repository.ts`) | Node/TypeScript backend review |
| C# / .NET (`*.cs`, Azure Functions) | C# / .NET review |
| React / Next.js (`*.tsx`, `app/**`, `pages/**`) | React review |
| CI/CD YAML (`*.yml`, `stages/`, `jobs/`, `steps/`, `.github/workflows/**`) | pipelines / GitHub-Actions review |
| SAST / security configs | security review |
| any diff | a general code-review gate (e.g. an `enhanced-reviewer`), if one is installed |

**3. Load** each matched skill: invoke it via the Skill tool if the runtime registered it; otherwise read its `SKILL.md` from the `path` that `list-skills.sh` printed. Apply its checks in Step 5. If nothing matches, proceed — built-in review knowledge is the baseline.

### Step 4: Fetch file content

Fetch each changed file with `ado.sh file` at the **source SHA**; for edited files also fetch the **target SHA** version and diff locally to see exactly what changed. Skip binaries (`.zip`, `.exe`, `.dll`, `.png`, `.jpg`, etc.).

```bash
<SKILL_DIR>/scripts/ado.sh file <REPO_ID> <FILE_PATH> <SOURCE_SHA> /tmp/new.ts
<SKILL_DIR>/scripts/ado.sh file <REPO_ID> <FILE_PATH> <TARGET_SHA> /tmp/old.ts   # edited files only
diff -u /tmp/old.ts /tmp/new.ts
```

**Read beyond the diff to understand it — a diff cannot be judged in isolation.** When a change calls a function, dispatches a command, implements an interface, or relies on a type defined elsewhere, **fetch those unchanged files too** (via `ado.sh file` at the source SHA) and read them. You cannot judge whether a changed method is correct without reading the helper it calls, the type it returns, or the guard it depends on. This is separate from the commenting rule:

> **Read widely, comment narrowly.** Read whatever unchanged code you need for understanding; only *post comments* on lines the PR changed. A problem you spot in unchanged code → mention it to the user as context, or file a separate issue — never a PR comment on an unchanged line.

### Step 4b: Objective build/lint gate (deterministic)

Before forming opinions, get **objective** ground truth. Run the gate on the changed files:

```bash
<SKILL_DIR>/scripts/checks.sh <REPO_NAME> <SOURCE_SHA> --changed <path1> <path2> ...
```

The gate needs a **local clone** of the repo to run. It finds one automatically when you run the review from inside that repo, or from a folder that holds it. If your clone lives elsewhere, point at it explicitly (a folder that contains the clone, or the clone itself):

```bash
<SKILL_DIR>/scripts/checks.sh <REPO_NAME> <SOURCE_SHA> --workspace <dir> --changed <path1> ...
# or set once:  export ADO_REVIEW_WORKSPACE=<dir>
```

- `GATE: PASS` → typecheck + lint clean on the changed files; note it in Passed Checks.
- `GATE: FAIL` → the printed compiler/eslint errors are **facts, not opinions**. Add each as a finding: type errors → `[B]`, lint/format → usually `[N]` (or `[S]` if it signals a real problem). Quote the tool's own message.
- `GATE: SKIPPED` → no local clone found (or no `node_modules`/`dotnet` to run with). Say so in the review; fall back to reading the code. Do **not** claim the code compiles. If a clone does exist, re-run with `--workspace <dir>`.

The gate runs in a throwaway worktree and never touches the user's checkout. Add `--full` to also run `npm run build` / `dotnet build` when a deeper check is warranted (larger PRs, build-config changes).

### Step 5: Analyze

Review the overall design first — understand the forest before examining trees.

**5a. Reconcile intent with implementation (do this FIRST — it catches the most).** The PR description, linked work items, and the user's stated goal are a contract. Break that contract into concrete claims and check **each one against the actual diff**:

- List every claim: each bug/AC in the description, and anything the user told you the PR should do.
- For each, find the code that delivers it and ask: *does it actually do this — always, or only sometimes?* Watch for **"always" vs conditional**, "all X" vs "some X", "before Y" vs "after Y".
- A gap between what was promised and what the code does is a finding — often the single most valuable one. (Classic example: the description says a reset is sent **always**, but the code only sends it under a condition — "always" ≠ "sometimes".)
- If reconciling requires reading unchanged code (the dispatched command, the fault source, the type), read it (Step 4) before concluding.

**5b. Evaluate each file across these lenses** (using the loaded skills):

- **Correctness** — Does the code do what the PR description says? Edge cases handled?
- **Async / races / ordering** — await gaps, fire-and-forget, state read right after an async write that hasn't settled, event-vs-command timing.
- **Error handling** — Explicit at boundaries? Typed errors? Nothing swallowed silently? Locks/resources released on the throw path?
- **Security** — Input validation, secrets, injection, auth checks.
- **Architecture** — Layer violations, responsibility placement, dependency direction.
- **SOLID / KISS / YAGNI / DRY** — principles from `enhanced-reviewer`.
- **Stack-specific** — Apply checks from the auto-detected skills loaded in Step 3.
- **Tests** — Do tests cover the changes? Are edge cases and error paths tested?

**5c. Self-verify every [B] before it survives.** A false blocker costs more trust than a missed nit. For each candidate blocker, actively try to **refute** it: re-read the exact lines, trace the values, check whether surrounding code already handles it. If you cannot make it fail concretely, downgrade it ([S]) or drop it. Assign each surviving finding a **confidence**: `High` (traced it, certain), `Med` (likely, some assumption), `Low` (worth raising, unsure). Only `High`-confidence issues may be `[B]`; a real-but-uncertain concern is `[S]`/`[N]` with the uncertainty stated.

**5d. Validate anchors (machine check).** Write the surviving findings to a findings TSV (`id⇥tag⇥file⇥line⇥quotedLine`, where `quotedLine` is the exact source line the comment targets) and run:

```bash
<SKILL_DIR>/scripts/ado.sh anchor <FINDINGS_TSV> <REPO_ID> <SOURCE_SHA>
```

Every finding must be `PASS`. A `REJECT` means your `line` or `quotedLine` is wrong — the script prints the real content of that line; fix the anchor (or drop the finding) and re-run until it prints `ANCHORS OK`. Do **not** present or post a finding whose anchor did not pass — a mis-anchored comment lands on the wrong line in the PR.

### Step 6: Present review to user

The findings table MUST include a **Comment** column with simple English explanation (for non-native speakers). This comment text is what gets posted to the PR.

```
## PR Review: #<PR_ID> — <title>
**Author:** <author>  **Branch:** <source> → <target>
**Size:** <Small/Medium/Large/XL> (<N> files, ~<N> lines)
**Skills:** <list of auto-detected skills used>

### Summary
<One sentence confirming what the PR accomplishes>

### Intent check (from Step 5a)
<One line per description claim / AC / stated goal → ✅ delivered, or ⚠️ gap (which becomes a finding below)>

### Findings
| # | Tag | Conf | File | Line | Issue | Suggested Fix | Comment |
|---|-----|------|------|------|-------|---------------|---------|
| 1 | [B] | High | auth.ts | 42 | No input validation | Add Zod schema | There is no check on user input. Bad data can break the system. Please add validation. |
| 2 | [S] | Med | api.ts  | 15 | Unparameterized query | Use parameterized query | The query is built with string concatenation. This can cause SQL injection. Please use parameters. |
| 3 | [N] | High | utils.ts | 8 | Unused import | Remove import | This import is not used anywhere. Please remove it to keep the code clean. |
| 4 | [P] | — | auth.service.ts | 30 | Clean error hierarchy | — | Good job on the error handling. Clean and easy to follow. |

`Conf` = confidence from Step 5c (High/Med/Low). Only `High` may be `[B]`.

### Verdict
<APPROVE / REQUEST CHANGES / COMMENT>
- Approve only if zero [B] items
- Request Changes if any [B] items remain

### Passed Checks
- Build/lint gate: <PASS / FAIL / SKIPPED> (from checks.sh)
- No hardcoded secrets ✓
- Layered architecture respected ✓
- Tests cover happy + error paths ✓

Which findings should I post as PR comments? (e.g., "1,2" or "all" or "none")
```

**STOP — wait for user to select which comments to post.**

### Step 7: Post approved comments

**First, dedup (idempotency).** Fetch existing threads and skip any finding whose file+line already has a thread — so re-running the review never double-posts. (Dedup key is location; if a *different* finding genuinely belongs on an already-commented line, open the PR thread to confirm before deciding.)

```bash
<SKILL_DIR>/scripts/ado.sh threads <REPO_ID> <PR_ID>       # TSV: path<TAB>line (one row per existing thread)
```

For each approved, non-duplicate finding, write a thread JSON to a temp file, then post it with `ado.sh post`.

**Comment format: NO severity tags.** Plain title + simple English comment:

```bash
# Temp path: $USERPROFILE works on Windows; ${TMPDIR:-/tmp} on macOS/Linux.
JSON="${TMPDIR:-/tmp}/pr-comment-1.json"
cat > "$JSON" << 'JSONEOF'
{
  "comments": [
    { "content": "**<plain issue title>**\n\n<simple English comment from Comment column>", "commentType": 1 }
  ],
  "status": 1,
  "threadContext": {
    "filePath": "/<file-path>",
    "rightFileStart": { "line": <line>, "offset": 1 },
    "rightFileEnd": { "line": <line>, "offset": 1 }
  }
}
JSONEOF

<SKILL_DIR>/scripts/ado.sh post <REPO_ID> <PR_ID> "$JSON"
```

Write all JSON files first, then post them. Thread status values: `1` = active, `2` = fixed, `4` = wontfix, `0` = unknown.

### Step 8: Verify posted, report, cleanup

**First, close the loop.** Reuse the findings TSV filtered to the approved+posted rows and confirm each comment actually landed:

```bash
<SKILL_DIR>/scripts/ado.sh verify-posted <APPROVED_FINDINGS_TSV> <REPO_ID> <PR_ID>
```

Every row must be `POSTED`. A `MISSING` means the comment did not land — re-post it before reporting success. Use the `POSTED`/`MISSING` result as the `Status` column below; never mark something `Posted` you did not verify.

```
## Comments Posted
| # | Tag | File | Line | Status |
|---|-----|------|------|--------|
| 1 | [B] | auth.ts | 42 | Posted (verified) |
| 2 | [S] | api.ts | 15 | Posted (verified) |

PR URL: <link>
```

Clean up temp JSON + findings TSV files (`${TMPDIR:-/tmp}` / `$USERPROFILE`) after posting. `checks.sh` cleans up its own worktree automatically.

## Pitfalls to Avoid

- **Rubber-stamping** — approving without reading the diff. Every approval is an assertion of quality
- **Nit avalanche** — drowning the author in style preferences. Save nits for mentoring; skip in time-sensitive reviews
- **Missing the forest** — reviewing line-by-line without understanding overall design
- **Blocking on style** — formatting and naming are almost never [B]. Reserve Blocking for bugs, security, data integrity
- **No praise** — always include at least one [P]. Good code deserves recognition
- **Scope creep** — commenting on unchanged code. If pre-existing issues bother you, file a separate issue
- **Diff in isolation** — judging a change without reading the unchanged code it depends on. Read the callee/type/interface before you conclude (Step 4, Step 5a)
- **Taking the description on faith** — assuming the code does what the PR says. Reconcile each claim against the diff (Step 5a); "always" is not "sometimes"
- **Confident-but-wrong blocker** — asserting a [B] you didn't verify. Try to refute every blocker first (Step 5c); if unsure, it's not [B]
- **Sequential API calls** — always batch file fetches in parallel. Never fetch one file at a time.

## Validation Checklist

Before presenting the review, confirm:
- [ ] Step 0 preflight passed (`ado.sh preflight` → Preflight OK.)
- [ ] Step 4b gate run (`checks.sh`) and its result reflected in findings + Passed Checks
- [ ] Existing threads checked (`ado.sh threads`) so no duplicate comments are posted
- [ ] PR context understood (purpose, size, CI status)
- [ ] **Intent reconciled** (Step 5a): every description claim / AC checked against the diff; gaps raised
- [ ] **Dependencies read** where needed to judge correctness (not just the changed files)
- [ ] **Every [B] self-verified** (Step 5c) and is High confidence; each finding has a Conf value
- [ ] **Anchors validated** (Step 5d): `ado.sh anchor` prints `ANCHORS OK` — no finding presented/posted with a failed anchor
- [ ] **Posts verified** (Step 8): `ado.sh verify-posted` shows every approved finding `POSTED` — no unverified `Posted` claims
- [ ] Relevant skills auto-detected and loaded from file paths
- [ ] All changed files reviewed (or highest-risk files for XL PRs)
- [ ] Feedback classified by severity ([B]/[S]/[N]/[P])
- [ ] Blocking items have specific fix suggestions
- [ ] At least one [P] Praise included
- [ ] Comment column has simple English for every finding
- [ ] Verdict matches findings (approve only if zero [B])
- [ ] No comments on unchanged code

## Error Handling
- If `az account show` fails → tell user to run `az login` (Step 0a)
- If `az devops` reports "extension not installed" → `az extension add --name azure-devops` (Step 0b)
- If org/project missing/empty or "no instance found" → ask user, then `az devops configure --defaults ...` (Step 0c)
- If PR not found → check org/project config: `az devops configure --list`
- If 403 on comment post → user may lack "Contribute to pull requests" permission
- If branch not found → use source commit SHA instead of branch name
- If `--in-file` fails → ensure using Windows path (`$USERPROFILE`), not `/tmp/`
- If `--resource threads` fails → use `--resource pullRequestThreads --api-version 7.1`
