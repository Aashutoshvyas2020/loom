# Loom Planning Algorithm

1. Read the governance files and approved implementation plan.
2. Run the exact startup command from `HANDOFF.md`.
3. Verify `REPO_MAP.md` is exhaustive against `git ls-files`.
4. Select the first incomplete task in order; amend the plan before regrouping or skipping.
5. Restate its acceptance checks in the handoff.
6. Write the smallest failing test for one required behavior.
7. Run it and record the expected failure.
8. Implement the minimum correct production code.
9. Run the targeted test until green.
10. Repeat for remaining task behaviors.
11. Run typecheck, full tests, and build.
12. Update map, changelog, handoff, and spec when required.
13. Commit only with green typecheck, tests, build, map, and governance.
14. Record SHA, evidence, blockers, and exact next command.
15. Stop only for a real unresolved blocker or completed approved scope.
