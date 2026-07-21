# SkillCatalog

A platform-agnostic **catalog of skills** for AI coding assistants — Claude Code,
GitHub Copilot, and OpenAI Codex. Browse the catalog, pull only the skills you need,
and they install into the right folder for your platform. Each skill extends the
assistant's base capabilities with a focused, reusable piece of expertise.

The catalog is standalone and host-agnostic: it knows nothing about any particular
consumer. Any external tool can import skills from it and add its own wiring at
import time; the catalog itself stays neutral.

## Skills

Skills live in **buckets** under `skills/`. Only the promoted buckets ship — see
[Buckets](#buckets) below.

| Skill | Bucket | What it does |
|-------|--------|--------------|
| **azure-reviewer** | `engineering` | Review Azure DevOps pull requests end-to-end via the `az` CLI — preflight (login/extension/org-project), fetch the diff, reconcile the PR's stated intent against the code, run an objective build/lint gate on the PR branch, classify findings by severity + confidence, and post approved comments back. Ships deterministic scripts (`ado.sh`, `checks.sh`) so the mechanical parts run identically every time, with machine-checked comment anchors and post-verification. **Reuses stack-specific review skills you already have installed** (Angular, C#, React, Node, pipelines… — discovered across project, global, and plugin scopes); no hard dependency — it falls back to built-in expertise when none match. |
| **diagnosing-bugs** | `engineering` | Six-phase discipline for hard bugs and performance regressions. Its leading idea: **build a tight feedback loop first** — one command you have already run that goes *red* on this specific bug — and refuse to hypothesise until it exists. Then reproduce → minimise → 3–5 falsifiable hypotheses → instrument (tagged `[DEBUG-xxxx]` logs) → fix behind a regression test → clean up and post-mortem. |
| **grilling** | `productivity` | A relentless interview that walks the decision tree **one question at a time**, looks facts up itself and puts only the *decisions* to you, and refuses to start work until you confirm shared understanding. Reach for it before building anything whose requirements are still fuzzy. |
| **writing-great-skills** | `productivity` | Reference for authoring and pruning skills: the invocation trade-off (**context load** vs **cognitive load**), the information hierarchy and progressive disclosure, checkable **completion criteria**, **leading words**, and the six failure modes — premature completion, duplication, sediment, sprawl, no-op, negation. Full definitions disclosed to its `GLOSSARY.md`. |
| **safety-ssh** | `ops` | Connect to remote servers over SSH **without the assistant ever handling passwords, usernames, hostnames, or IP addresses.** Everything goes through a named SSH *connection* whose real details live in `~/.ssh/config` and whose key lives in `ssh-agent`. Includes deterministic scripts for the full flow (check → scaffold → authorize → run). |

## Installing skills

### Claude (native marketplace) — installs globally

```text
/plugin marketplace add krukovden/skill-catalog
/plugin install skill-catalog@skillcatalog
```

This is **user-scoped (global)**: Claude clones the repo into `~/.claude/plugins/` and
installs the skills listed in `.claude-plugin/plugin.json` — the **promoted** ones —
making them available in all your projects at once. It's the whole promoted bundle; for
per-skill selection or local-only install (or Copilot/Codex), use the CLI below instead.
Update later with `/plugin`.

### Any platform (interactive CLI)

Run inside your project, pick a platform, choose **local vs global**, then select skills:

```bash
npx github:krukovden/skill-catalog
```

| Platform | Local (this project) | Global (all projects) |
|----------|----------------------|-----------------------|
| Claude   | `.claude/skills/<name>/` | `~/.claude/skills/<name>/` |
| Codex    | `.codex/skills/<name>/` (full tree) + managed block in `AGENTS.md` | `~/.codex/skills/<name>/` (full tree) + managed block in `~/.codex/AGENTS.md` |
| Copilot  | `.github/instructions/<name>.instructions.md` | — (repo-scoped only) |

The CLI asks *where* to install (local project vs global user home) for the platforms
that support both; Copilot is repo-scoped, so it always installs locally. Re-running is
safe (idempotent) — the Codex adapter only rewrites its own managed block in `AGENTS.md`,
preserving the rest of the file.

## Buckets

Every skill sits in a bucket folder, and **the bucket is the skill's status** — there is no
separate status field to keep in sync.

| Bucket | Promoted? | For |
|--------|-----------|-----|
| `engineering/` | ✅ | day-to-day code work |
| `ops/` | ✅ | machines and infrastructure |
| `productivity/` | ✅ | workflow tools not tied to code |
| `in-progress/` | ❌ | being built — committable, never shipped |
| `deprecated/` | ❌ | retired — kept for the record |

Promoted skills appear in `catalog.json`, in the Claude plugin manifest, and in the table
above. Unpromoted ones appear in none of them, which is the point: an unfinished skill can
be committed, reviewed and evaluated in the open without ever reaching a user. Promoting,
demoting or retiring a skill is a `git mv` between buckets plus `npm run build`.

## Project structure

```text
SkillCatalog/
├── skills/                      # THE CONTENT — source of truth, grouped into buckets
│   ├── engineering/             #   promoted bucket — ships
│   │   └── <name>/
│   │       ├── SKILL.md         #     required: frontmatter (name, description) + instructions
│   │       ├── scripts/         #     optional: deterministic helper scripts the skill runs
│   │       ├── references/      #     optional: docs the assistant loads on demand
│   │       └── evals/           #     optional: test prompts used to validate the skill
│   ├── ops/                     #   promoted bucket — ships
│   ├── in-progress/             #   not promoted — never ships
│   └── deprecated/              #   not promoted — never ships
│
├── cli/                         # THE INSTALLER
│   ├── index.js                 #   interactive prompt: choose platform + skills
│   ├── catalog.js               #   load/validate catalog, parse skill frontmatter
│   └── adapters/                #   per-platform install logic (pure functions)
│       ├── claude.js            #     → .claude/skills/<name>/
│       ├── copilot.js           #     → .github/instructions/<name>.instructions.md
│       └── codex.js             #     → .codex/skills/<name>/ (full tree) + AGENTS.md block
│
├── bin/skillcatalog.js          # npx entry point → cli/index.js
├── scripts/build.js             # regenerates the generated files below from skills/
├── test/run.js                  # unit tests for adapters + build sanity check
│
├── catalog.json                 # GENERATED — the runtime skill list the CLI reads
├── .claude-plugin/
│   ├── marketplace.json         # GENERATED — makes this repo a Claude marketplace
│   └── plugin.json              # GENERATED — the plugin manifest Claude loads
│
├── package.json                 # zero runtime dependencies; its `version` is the release version
├── CLAUDE.md                    # the rules for extending this repo — read before adding a skill
└── README.md
```

**Generated files** (`catalog.json`, `.claude-plugin/*`) are committed because consumers
read them directly — Claude reads `marketplace.json` when you add the catalog, and the
CLI reads `catalog.json`. You never edit them by hand; run `npm run build` after changing
skills and they regenerate from the `skills/` folder.

The release version lives in `package.json` and `build.js` writes it into `plugin.json` —
bump it on every user-visible change, because Claude uses that field to decide when
installed users see an update.

`docs/` and `skills/*/*-workspace/` are local-only (git-ignored): design notes and
transient eval results that are never published.

## Authoring a skill

Add a folder under the bucket it belongs to:

```yaml
# skills/<bucket>/<name>/SKILL.md
---
name: <name>                 # must match the folder name
description: <one line>      # how the assistant decides when to use the skill
---

# Body — the actual skill instructions
```

Then regenerate and test:

```bash
npm run build     # writes catalog.json, .claude-plugin/marketplace.json, plugin.json
npm test          # adapter unit tests + build sanity check
```

Then add the skill to its bucket's `README.md`, and — if the bucket is promoted — to the
table at the top of this file.

You only ever edit files under `skills/`; everything else is generated or tooling. The full
set of rules, including the invariants the build and tests enforce, is in
[CLAUDE.md](./CLAUDE.md).

Starting something you're not ready to ship? Put it in `skills/in-progress/`. It will be
committed and reviewable but excluded from `catalog.json`, the plugin, and this README
until you `git mv` it into a promoted bucket.
