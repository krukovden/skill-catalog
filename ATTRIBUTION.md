# Attribution

Parts of this catalog are adapted from third-party work. This file records what, from
where, and under which licence.

## mattpocock/skills

Source: <https://github.com/mattpocock/skills> — Copyright (c) Matt Pocock, MIT licence.

| Here | Derived from | Nature of the change |
|------|--------------|----------------------|
| `skills/productivity/grilling/` | `skills/productivity/grilling` | Near-verbatim. Description rewritten with fuller trigger phrasing; "explore the environment" widened to name git history and the network. |
| `skills/productivity/writing-great-skills/` | `skills/productivity/writing-great-skills` (incl. `GLOSSARY.md`) | Body substantially verbatim. Converted from user-invoked to model-invoked (this catalog has no per-platform invocation metadata yet), and a closing **Applying this in SkillCatalog** section added covering self-contained skill folders, buckets, and trigger evals. |
| `skills/engineering/diagnosing-bugs/` (incl. `scripts/hitl-loop.template.sh`) | `skills/engineering/diagnosing-bugs` | Body substantially verbatim. Pointers to skills this catalog does not carry (`domain-modeling`/`CONTEXT.md`, `improve-codebase-architecture`) removed; the Phase 6 architectural hand-off rewritten as a self-contained instruction. |
| `skills/engineering/azure-reviewer/` — the two-axis structure in Step 5 and `references/smell-baseline.md` | `skills/engineering/code-review` | Adapted, not copied. The Spec/Standards split, the parallel sub-agent dispatch, the "repo standard overrides the baseline" rule, the "never rerank across axes" rule, and the twelve-smell baseline (Fowler, _Refactoring_ ch. 3) were grafted onto an existing Azure DevOps skill that keeps its own scripts, findings TSV, anchor validation, and post-verification. |

### MIT licence (mattpocock/skills)

```
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Other sources

- The smell baseline in `skills/engineering/azure-reviewer/references/smell-baseline.md`
  restates code smells catalogued in Martin Fowler, _Refactoring_ (2nd ed.), ch. 3. The
  names are the book's; the one-line fixes and the reviewer-facing rules are our wording.
