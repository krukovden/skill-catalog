# Smell baseline — the Standards axis fallback

A fixed set of code smells (Fowler, _Refactoring_ ch. 3) that the **Standards** axis carries **on top of** whatever the repo documents. It exists so the axis still has teeth when a repo documents no standards at all — which is most repos.

## Two rules bind it

- **The repo overrides.** A documented repo standard always wins. Where the repo endorses something this baseline would flag, suppress the smell and say nothing.
- **Always a judgement call.** Every entry here is a labelled heuristic ("possible Feature Envy"), never a hard violation. A documented-standard breach can be hard; a baseline smell never is. Under the severity rules that makes a bare smell `[S]` or `[N]` — a smell alone is not evidence for `[B]`, though the *bug it reveals* may be.
- **Skip what tooling enforces.** If `eslint`/`tsc`/`dotnet build` already catches it, Step 4b's gate reports it as fact. Don't duplicate it as an opinion.

## The smells

Each reads *what it is* → *how to fix*. Match against the diff.

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does or holds. → Rename it; if no honest name comes, the design is murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file in the change. → Extract the shared shape, call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. → Move the method onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together (a type wanting to be born). → Bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that deserves its own type. → Give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurs across the change. → Replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the diff. → Gather what changes together into one module.
- **Divergent Change** — one file or module is edited for several unrelated reasons. → Split so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the PR description doesn't have. → Delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → Hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward. → Cut it, call the real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it inherits. → Drop the inheritance, use composition.

## Reporting

Name the smell and quote the hunk that triggered it. A smell you cannot anchor to a specific changed line does not become a finding — the anchor check in Step 5e would reject it anyway.
