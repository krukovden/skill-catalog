# SkillCatalog

A platform-agnostic **catalog of skills** for AI coding assistants — Claude Code,
GitHub Copilot, and OpenAI Codex. Browse the catalog, pull only the skills you need,
and they install into the right folder for your platform. Each skill extends the
assistant's base capabilities with a focused, reusable piece of expertise.

The catalog is standalone and host-agnostic: it knows nothing about any particular
consumer. Any external tool can import skills from it and add its own wiring at
import time; the catalog itself stays neutral.

## Skills

| Skill | What it does |
|-------|--------------|
| **azure-reviewer** | Review Azure DevOps pull requests end-to-end via the `az` CLI — preflight (login/extension/org-project), fetch the diff, reconcile the PR's stated intent against the code, run an objective build/lint gate on the PR branch, classify findings by severity + confidence, and post approved comments back. Ships deterministic scripts (`ado.sh`, `checks.sh`) so the mechanical parts run identically every time, with machine-checked comment anchors and post-verification. |
| **safety-ssh** | Connect to remote servers over SSH **without the assistant ever handling passwords, usernames, hostnames, or IP addresses.** Everything goes through a named SSH *connection* whose real details live in `~/.ssh/config` and whose key lives in `ssh-agent`. Includes deterministic scripts for the full flow (check → scaffold → authorize → run). |

## Installing skills

### Claude (native marketplace)

```text
/plugin marketplace add krukovden/skill-catalog
```

Then install the `skill-catalog` plugin. Claude auto-discovers the skills.

### Any platform (interactive CLI)

Run inside your project, pick a platform, choose **local vs global**, then select skills:

```bash
npx github:krukovden/skill-catalog
```

| Platform | Local (this project) | Global (all projects) |
|----------|----------------------|-----------------------|
| Claude   | `.claude/skills/<name>/` | `~/.claude/skills/<name>/` |
| Codex    | `.codex/skills/<name>.md` + managed block in `AGENTS.md` | `~/.codex/skills/<name>.md` + managed block in `~/.codex/AGENTS.md` |
| Copilot  | `.github/instructions/<name>.instructions.md` | — (repo-scoped only) |

The CLI asks *where* to install (local project vs global user home) for the platforms
that support both; Copilot is repo-scoped, so it always installs locally. Re-running is
safe (idempotent) — the Codex adapter only rewrites its own managed block in `AGENTS.md`,
preserving the rest of the file.

## Project structure

```text
SkillCatalog/
├── skills/                      # THE CONTENT — one folder per skill (source of truth)
│   └── <name>/
│       ├── SKILL.md             #   required: frontmatter (name, description) + instructions
│       ├── scripts/             #   optional: deterministic helper scripts the skill runs
│       ├── references/          #   optional: docs the assistant loads on demand
│       └── evals/               #   optional: test prompts used to validate the skill
│
├── cli/                         # THE INSTALLER
│   ├── index.js                 #   interactive prompt: choose platform + skills
│   ├── catalog.js               #   load/validate catalog, parse skill frontmatter
│   └── adapters/                #   per-platform install logic (pure functions)
│       ├── claude.js            #     → .claude/skills/<name>/
│       ├── copilot.js           #     → .github/instructions/<name>.instructions.md
│       └── codex.js             #     → .codex/skills/<name>.md + AGENTS.md block
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
├── package.json                 # zero runtime dependencies (Node built-ins only)
└── README.md
```

**Generated files** (`catalog.json`, `.claude-plugin/*`) are committed because consumers
read them directly — Claude reads `marketplace.json` when you add the catalog, and the
CLI reads `catalog.json`. You never edit them by hand; run `npm run build` after changing
skills and they regenerate from the `skills/` folder.

`docs/` and `skills/*-workspace/` are local-only (git-ignored): design notes and
transient eval results that are never published.

## Authoring a skill

Add a folder under `skills/`:

```yaml
# skills/<name>/SKILL.md
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

You only ever edit files under `skills/`; everything else is generated or tooling.
