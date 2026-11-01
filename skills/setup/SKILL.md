---
name: setup
description: Configure Ship for a project by detecting its repos, gates and tracker and writing .ship/config.md. Use when the user asks to set up Ship or when another Ship skill reports a missing config.
disable-model-invocation: true
---

Read `${CLAUDE_PLUGIN_ROOT}/references/protocol.md` and `${CLAUDE_PLUGIN_ROOT}/references/config-schema.md`.

1. **Detect.** Find git repos at and directly below the working directory, each one's base branch, its gates (package scripts, Makefile, CI workflows) and its existing docs. If `.ship/config.md` exists, you are updating it: keep what's there.
2. **Ask the user** only what detection can't settle, giving your recommendation for each:
   - Tracker: `files`, `github`, `linear` or `custom`. Recommend `files` unless the project already uses a tracker.
   - Which gates must the user run themselves? Set `agent_may_run: false` for anything touching shared data or needing their environment.
   - Which project commands should be blocked or need a prompt? Add them as `permissions.custom`.
3. **Write** `.ship/config.md` from `${CLAUDE_PLUGIN_ROOT}/templates/config.md`. If the root isn't a git repo, put it in the main repo. Add `.ship/runs/` and `.ship/approvals/` to `.gitignore`.
4. **Validate** with `node "${CLAUDE_PLUGIN_ROOT}/bin/ship.mjs" config`. For a CLI-run tracker other than GitHub, also run `ship tracker conformance`.
5. Report what was detected, what you assumed, and that the next step is `/ship:spec`.
