---
name: review
description: Review code on two separate axes, standards and spec. Takes a Ship ticket, or any branch or PR with no Ship setup needed. Use when the user wants a ticket, branch, PR or existing change reviewed.
argument-hint: "[ticket-id | branch | PR number or URL] [--spec <path>] [--base <branch>]"
disable-model-invocation: true
---

Read `${CLAUDE_PLUGIN_ROOT}/references/protocol.md`. Read `.ship/config.md` if the project has one.

Input: $ARGUMENTS

## Pick the mode

- **Ticket mode:** the input matches an existing `.ship/runs/<input>.json`.
- **Standalone mode:** anything else, including no input, which means the current branch. If an input could be either, say which you chose.

## The two reviews

Both modes use these. Spawn two sub-agents in parallel, each with a fresh context, given the diff command and one brief:

- **Standards:** Check the diff against the project's documented standards. Cite the rule for each finding. Skip what tooling already enforces.
- **Spec:** Report requirements missing or partial, behaviour nobody asked for, and implementations that look wrong. Quote the requirement for each finding.

Report the two axes separately. Don't merge or re-rank them: a change can pass one and fail the other.

## Standalone mode

This mode is read-only. It needs no config, and it creates no run, approval or tracker entry. Don't edit code unless the user asks afterwards.

1. Run `ship review scope [target] [--repo <name>] [--base <branch>]`, from the repo's folder if there's no config. Pass on any `warnings`. On `EMPTY_DIFF`, say there's nothing to review and stop.
2. **Find the standards:** `hard_rules` and `read_before_change` if there's a config, plus `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md` and any coding standards docs. If none exist, tell the user the standards review has no documented rules to check against, and skip it rather than inventing some.
3. **Find the spec,** in this order: the `--spec` path, the PR body if it states requirements, then a linked issue. If there's none, skip the spec review and say so. Never infer requirements from the code itself.
4. Run the reviews that have a source, using `diffCommand` from the scope.
5. Report which reviews ran, which were skipped and why, then the findings.

## Ticket mode

The run must be in `reviewing`. Check with `ship run show <ticket>`.

1. For each repo in the run, find the diff against its base branch: `git diff <base>...HEAD`.
2. Run `ship coverage <ticket>` to see acceptance ids with no test.
3. Run both reviews. Standards uses the project's documented standards, `hard_rules` and `read_before_change` docs. Spec uses the ticket and its spec.
4. **Ask the user** to decide each finding: `fix`, `accept` or `reject`. Then stop and wait.
5. For `fix`: `ship run transition <ticket> building`, make the change, commit, and return through verifying with `ship gate run`.
6. Write every finding to a JSON file and record it with `ship run review <ticket> --file <path>`:

   ```json
   [{ "id": "F1", "axis": "spec", "summary": "...", "decision": "accept" }]
   ```

   Use `fixed` for findings now fixed. Uncovered acceptance ids are added automatically and also need a decision.
7. Show the final list. On a clear yes, run `ship approve review <ticket> --by "<name>" --quote "<their exact reply>"`.

New commits void this approval.

Next step: `/ship:pr <ticket>`.
