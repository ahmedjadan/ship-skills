---
name: spec
description: Turn an idea into an approved spec with scope, non-goals, acceptance ids, risks and open questions. Use when the user wants to specify, scope or define a feature before building it.
argument-hint: "[idea or path]"
disable-model-invocation: true
---

Read `${CLAUDE_PLUGIN_ROOT}/references/protocol.md`, then the project's `.ship/config.md`.

Input: $ARGUMENTS

1. **Gather facts yourself.** Read the docs in `read_before_change` that apply and the code involved. Note anything that constrains the work, and any place docs and code disagree.
2. **Interview in rounds.** Ask only what's ready to decide, number the questions, and give a recommended answer for each. A decision that depends on an open one waits for a later round. Stop when nothing is silently assumed.
3. **Write the spec** to `<specs.path>/<slug>.md` from `${CLAUDE_PLUGIN_ROOT}/templates/spec.md`. The slug is the spec id. Each acceptance item is observable behaviour with an id in the config's `acceptance_id` format, unique in the project.
4. **Resolve open questions.** A spec with open questions can't be approved. Take them back to the user.
5. **Ask for approval.** Show the spec's path and summary, then stop and wait. On a clear yes, run `ship approve spec <slug> --by "<name>" --quote "<their exact reply>"` and confirm with `ship spec status <slug>`.

If you edit the spec afterwards, it returns to draft and needs approval again.

Next step: `/ship:tickets <slug>`.
