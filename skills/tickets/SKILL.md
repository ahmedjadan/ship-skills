---
name: tickets
description: Break an approved spec into vertical-slice tickets with blockers and publish them to the configured tracker. Use when the user wants to slice a spec into tickets.
argument-hint: "<spec-id>"
disable-model-invocation: true
---

Read `${CLAUDE_PLUGIN_ROOT}/references/protocol.md` and `${CLAUDE_PLUGIN_ROOT}/references/tracker-contract.md`, then `.ship/config.md` and the adapter doc for `tracker.kind`.

Spec: $ARGUMENTS

1. Confirm `ship spec status <spec-id>` says `approved`. If not, stop.
2. **Cut vertical slices.** Each ticket is a narrow but complete path through every layer, verifiable on its own and small enough for one fresh session. Prefactoring goes first. A mechanical change too wide for one slice is the exception: expand, migrate in batches, then contract.
3. **Assign acceptance.** Every acceptance id in the spec belongs to exactly one ticket. Blockers are only real dependencies.
4. **Write the breakdown** to a scratch JSON file, blockers before dependants, with bodies based on `${CLAUDE_PLUGIN_ROOT}/templates/ticket.md`:

   ```json
   [{ "number": 1, "title": "...", "body": "...", "acceptance": ["AC-1"], "blockedBy": [] }]
   ```

   Check it with `ship tickets validate --spec <spec-id> --file <path>`.
5. **Ask for approval.** List each ticket's title, blockers and what it delivers, then stop and wait. Revise until the user says yes. Any change to the file needs a fresh yes.
6. **Publish.** Run `ship approve tickets <spec-id> --file <path> --by "<name>" --quote "<their exact reply>"`, then:
   - CLI-run tracker: `ship tickets publish --spec <spec-id> --file <path>`.
   - Agent-run tracker: follow its adapter doc, checking each result with `ship tracker check create`.

Next step: `/ship:implement <spec-id>`.
