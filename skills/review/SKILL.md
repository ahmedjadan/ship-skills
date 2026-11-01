---
name: review
description: Review a ticket's change on two separate axes, standards and spec, plus acceptance coverage, and record a decision on every finding. Use when the user wants a ticket's work reviewed before opening a PR.
argument-hint: "<ticket-id>"
disable-model-invocation: true
---

Read `${CLAUDE_PLUGIN_ROOT}/references/protocol.md`, then `.ship/config.md`.

Ticket: $ARGUMENTS

The run must be in `reviewing`. Check with `ship run show <ticket>`.

1. For each repo in the run, find the diff against its base branch: `git diff <base>...HEAD`.
2. Run `ship coverage <ticket>` to see acceptance ids with no test.
3. **Spawn two sub-agents in parallel, each with a fresh context,** given the diff command and these briefs:
   - **Standards:** Check the diff against the project's documented standards, `hard_rules` and `read_before_change` docs. Cite the rule for each finding. Skip what tooling already enforces.
   - **Spec:** Given the ticket and spec, report requirements missing or partial, behaviour nobody asked for, and implementations that look wrong. Quote the requirement for each finding.
4. **Report the two axes separately.** Don't merge or re-rank them: a change can pass one and fail the other.
5. **Ask the user** to decide each finding: `fix`, `accept` or `reject`. Then stop and wait.
6. For `fix`: `ship run transition <ticket> building`, make the change, commit, and return through verifying with `ship gate run`.
7. Write every finding to a JSON file and record it with `ship run review <ticket> --file <path>`:

   ```json
   [{ "id": "F1", "axis": "spec", "summary": "...", "decision": "accept" }]
   ```

   Use `fixed` for findings now fixed. Uncovered acceptance ids are added automatically and also need a decision.
8. Show the final list. On a clear yes, run `ship approve review <ticket> --by "<name>" --quote "<their exact reply>"`.

New commits void this approval.

Next step: `/ship:pr <ticket>`.
