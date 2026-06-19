---
name: demo-skill
description: Demonstration skill used to validate the SkillCatalog install pipeline across Claude, Copilot, and Codex. Activate when verifying that a skill installs correctly.
---

# Demo Skill

This skill exists to prove the catalog mechanics end to end. It carries no real domain
knowledge — it is a placeholder that every adapter must be able to install.

## When to activate

- A user is verifying that SkillCatalog installs skills into the right platform folders.
- You need a known-good skill to test the CLI, adapters, or marketplace build.

## What it does

Nothing functional. When asked to use the demo skill, simply confirm that it was loaded
and report which platform folder it was installed into.
