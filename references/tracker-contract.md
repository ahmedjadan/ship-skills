# Tracker adapter contract

Skills talk to a tracker only through these operations, so any tracker can sit behind them.

## Operations

| Operation | Result |
|---|---|
| `create(ticket)` | `{id, url}` |
| `get(id)` | Ticket |
| `list({spec, status})` | Ticket[] |
| `next({spec})` | The first `ready` ticket with every blocker `done`, or `null` |
| `transition(id, status, note)` | The updated Ticket |

`create` receives `spec`, `number`, `title`, `body`, `blockedBy` (real ids) and `acceptance`.

## Ticket

```json
{
  "id": "string",
  "title": "string",
  "body": "string",
  "status": "ready | in_progress | in_review | done | blocked",
  "blockedBy": ["ticket id"],
  "acceptance": ["acceptance id"],
  "url": "string",
  "spec": "string, optional"
}
```

## Rules

- **Statuses are Ship's.** Each adapter maps them to its tracker's states and back.
- **`create` is idempotent,** keyed on spec plus number. A retry returns the existing ticket and never duplicates.
- **`transition` follows the ticket lifecycle** in `protocol.md`. An illegal move fails with `ILLEGAL_TRANSITION`.
- **Failures use fixed codes:** `NOT_FOUND`, `CONFLICT`, `UNAUTHORIZED`, `UNAVAILABLE`. Nothing fails silently, and a failed write leaves the run where it was.
- **Credentials stay with the user's tools** (`gh` auth, MCP connections). Adapters never store them.

## Two kinds of adapter

- **CLI-run** (`files`, `github`): `ship` performs the operations. Prove one with `ship tracker conformance`; on `github` that creates real issues, so it also needs `--live`.
- **Agent-run** (`linear`, `custom`): the agent performs the operations using its adapter doc, then validates every result:

```bash
echo '<result json>' | ship tracker check <operation>
```

For agent-run adapters, `ship run transition` returns a `trackerAction`. Perform it, or the tracker and run will disagree and `ship run resume` can't detect it.

## Writing a custom adapter

1. Copy `references/trackers/linear.md` as a starting point and keep it in your project.
2. State how each operation is done, and the status mapping.
3. Set `tracker.kind: custom` and `tracker.adapter: <path>` in the config.
