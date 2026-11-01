---
name: pr
description: Open one cross-linked pull request per touched repo with evidence-backed bodies, then update the ticket. Use when the user wants to open PRs for a reviewed ticket.
argument-hint: "<ticket-id>"
disable-model-invocation: true
---

Read `${CLAUDE_PLUGIN_ROOT}/references/protocol.md`, then `.ship/config.md`.

Ticket: $ARGUMENTS

The run must be in `reviewing` with a recorded, approved review.

1. Run `ship pr body <ticket>`. Fill in the prose sections only. The Verification, Not run and Decisions sections come from recorded evidence: never edit them.
2. Show the user the title, target branch and body for each repo, then stop and wait. On a clear yes, run `ship approve pr <ticket> --by "<name>" --quote "<their exact reply>"`.
3. For each repo the run touched, push the ticket branch and open a PR into its base branch. The permission hook may prompt.
4. Record each one: `ship pr record <ticket> --repo <repo> --url <url>`.
5. If several repos are involved, add the other PRs and the merge order to each body.
6. Run `ship run transition <ticket> pr_open`. For an agent-run tracker, perform the returned `trackerAction`.
7. Give the user the PR links and everything under Not run.

**You don't merge.** After the PR merges, on the user's word, run `ship run transition <ticket> done` to close the ticket and unblock what depends on it.
