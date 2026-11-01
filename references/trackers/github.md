# Tracker: GitHub issues

Set `tracker.kind: github` and `tracker.repo: owner/name`. Requires an authenticated `gh`.

Run by the CLI. Ids are issue numbers. Tickets carry a `ship` label and a `ship:<status>` label; `done` closes the issue. Blockers, acceptance ids and the idempotency key are kept in a hidden comment in the issue body, so edit the visible text only.

Tickets from several code repos all live in `tracker.repo`. Lists are capped at 1000 issues.
