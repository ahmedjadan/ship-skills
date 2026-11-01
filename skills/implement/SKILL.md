---
name: implement
description: Build the next unblocked ticket through an approved plan, one commit per step, with recorded gate evidence, resuming any unfinished run. Use when the user wants to implement a ticket or continue one.
argument-hint: "[ticket-id or spec-id]"
disable-model-invocation: true
---

Read `${CLAUDE_PLUGIN_ROOT}/references/protocol.md`, then `.ship/config.md`.

Target: $ARGUMENTS

## Start or resume

If `.ship/runs/<ticket>.json` exists, run `ship run resume <ticket>`. Show the state, next step and any mismatches. If there are mismatches, stop and ask how to proceed. Otherwise continue from the reported state and skip completed steps.

For a new run, find the ticket with `ship tracker next --spec <spec-id>` or use the id given, and state its title. Then `ship run start <ticket>`.

## Plan (`planned`)

1. Read the ticket, its spec, and the docs in `read_before_change`. Follow any rules they set, and report conflicts between them.
2. Write a plan to a scratch JSON file, ordered by `build_order`, with one step per commit:

   ```json
   { "summary": "...", "files": ["..."], "steps": [{ "id": "s1", "title": "...", "repo": "app" }] }
   ```

3. Run `ship run plan <ticket> --file <path>`, show the plan, then stop and wait. On a clear yes, run `ship approve plan <ticket> --by "<name>" --quote "<their exact reply>"` and `ship run transition <ticket> building`.

## Build (`building`)

For each step:

1. Create or switch to the ticket branch using the `branch` pattern, in the step's repo.
2. Write the code. Tests name the acceptance id they prove, e.g. `it("AC-1: ...")`.
3. Update whatever the `done` list requires as part of the same change.
4. Commit using the `commit` pattern.
5. Run `ship run step <ticket> <step-id>`.

Record any decision the plan didn't cover with `ship run decide <ticket> --text "..."`. If the plan itself is wrong, stop and tell the user. An approved plan can't be edited once building has begun.

Record work blocked on someone else with `ship run transition <ticket> paused`, and say what's needed.

## Verify (`verifying`)

1. `ship run transition <ticket> verifying`, then `ship gate run <ticket>`.
2. If a gate fails, fix it, `ship run transition <ticket> building`, commit, and run gates again. Never weaken a test or gate to pass.
3. Give the user each command in `handoff` to run themselves. If they report results, record them with `ship gate report <ticket> --repo <repo> --name <gate> --exit <code> --quote "<their exact reply>"`. Don't wait for this: unreported gates appear under Not run.
4. `ship run transition <ticket> reviewing`.

Report what was built and which gates passed or weren't run. Next step: `/ship:review <ticket>`.
