# SkillCatalog

A platform-agnostic **catalog of skills** for Claude Code, GitHub Copilot, and OpenAI
Codex. Pull only the skills you need to extend your assistant's base capabilities.

The catalog is standalone and knows nothing about any particular host. If you also use
[sdlc](https://github.com/krukovden/sdlc), it can consume this catalog to extend its
skill base — the dependency is one-way (**sdlc → catalog**, never the reverse).

## Install skills

### Claude (native marketplace)

```text
/plugin marketplace add krukovden/SkillCatalog
```

Then install the `skill-catalog` plugin. Skills are auto-discovered from `skills/`.

### Any platform (interactive CLI)

Run inside your project; pick a platform, then select skills:

```bash
npx github:krukovden/SkillCatalog
```

| Platform | Installs to |
|----------|-------------|
| Claude   | `.claude/skills/<name>/` (full skill folder) |
| Copilot  | `.github/instructions/<name>.instructions.md` |
| Codex    | `.codex/skills/<name>.md` + a managed block in `AGENTS.md` |

Re-running is safe (idempotent). The Codex adapter only rewrites its own managed block in
`AGENTS.md`, preserving the rest of the file.

## Authoring a skill

Add a folder under `skills/`:

```text
skills/<name>/
  SKILL.md            # required
  references/ assets/ # optional
```

`SKILL.md` frontmatter:

```yaml
---
name: <name>                 # must match the folder name
description: <one line>       # used for discovery/triggering
sdlc:                        # OPTIONAL — ignored by Claude/Copilot/Codex, read by sdlc
  agent: coder
  phase: implement
---

# Body — the actual skill instructions
```

Then regenerate the derived manifests:

```bash
npm run build     # writes catalog.json, .claude-plugin/marketplace.json, plugin.json
npm test          # adapter unit tests + build sanity e2e
```

You only ever edit `SKILL.md` files; `catalog.json` and the Claude manifests are generated.

## Layout

```text
catalog.json                     # generated runtime list (CLI reads this)
.claude-plugin/marketplace.json  # generated Claude marketplace
.claude-plugin/plugin.json       # generated plugin manifest
skills/<name>/SKILL.md           # source of truth
cli/                             # interactive installer + per-platform adapters
scripts/build.js                 # regenerates the generated files
test/run.js                      # tests
docs/superpowers/specs/          # design spec
```

See [the design spec](docs/superpowers/specs/2026-06-19-skill-catalog-design.md) for the
full rationale.
