# Tracker: Linear

Set `tracker.kind: linear` and `tracker.team: <team key>`. Agent-run, through the user's Linear MCP connection. If it isn't connected, stop and tell the user to authorise it.

**Status: unverified.** This adapter has not been exercised against a live workspace.

| Ship status | Linear state type |
|---|---|
| `ready` | Unstarted |
| `in_progress` | Started |
| `in_review` | Started, in a state named "In Review" |
| `blocked` | Any open state, with a `blocked` label |
| `done` | Completed |

| Operation | How |
|---|---|
| `create` | Search the team for `ship-key: <spec>#<number>` first and return a match. Otherwise create the issue with that line at the end of its description. Add blocking relations for `blockedBy`. |
| `get`, `list` | Read issues and map them to the Ticket shape. `acceptance` comes from an `Acceptance:` line in the description. |
| `next` | From `list`, the first `ready` ticket whose blockers are all `done`. |
| `transition` | Check the move is legal under the ticket lifecycle, set the state, add `note` as a comment. |

Map tool failures to the contract's error codes. Pipe every result through `ship tracker check <operation>`.

For `/ship:implement`, save `{"ticket": <Ticket>, "blockers": [<Ticket>]}` to a scratch file and pass it to `ship run start <id> --ticket-file <path>`.
