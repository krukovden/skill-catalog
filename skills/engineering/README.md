# engineering

Skills for day-to-day code work — reviewing, building, debugging.

**Promoted**: skills here ship in `catalog.json` and the Claude plugin.

- **[azure-reviewer](./azure-reviewer/SKILL.md)** — Review Azure DevOps pull requests end-to-end via the `az` CLI: preflight, fetch the diff, then review along two independent axes — **Spec** (does it do what the PR said?) and **Standards** (repo conventions plus a Fowler smell baseline) — run as parallel sub-agents, with a build/lint gate, machine-checked comment anchors, and post-verification.
- **[diagnosing-bugs](./diagnosing-bugs/SKILL.md)** — Six-phase discipline for hard bugs and performance regressions. Refuses to theorise until a **tight** feedback loop already goes red on *this* bug; then reproduce → minimise → rank falsifiable hypotheses → instrument → fix with a regression test → clean up and post-mortem. Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT) — see [ATTRIBUTION.md](../../ATTRIBUTION.md).
