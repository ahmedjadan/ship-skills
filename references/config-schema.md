# Config reference: `.ship/config.md`

YAML front matter, then free-text project notes. `ship config` validates it. Only a small YAML subset is supported: maps, lists, scalars, quoted strings and inline `[a, b]` lists.

The file is found by walking up from the working directory, then one level down, so a root that isn't a git repo can use a config kept in one of its repos. `repos[].path` and `specs.path` are relative to the folder holding `.ship/`.

| Key | Required | Meaning |
|---|---|---|
| `version` | Yes | `1` |
| `repos` | Yes | List of `name`, `path`, `base` (base branch) |
| `tracker` | Yes | `kind`: `files`, `github`, `linear` or `custom`. Plus `path`, `repo`, `team` or `adapter` |
| `specs` | Yes | `path`, and optional `acceptance_id` format such as `AC-<AREA>-NN` |
| `gates` | Yes | List of `repo`, `name`, `command`, `agent_may_run`. May be empty |
| `branch` | Yes | Branch pattern, e.g. `feature/{ticket}-{slug}` |
| `read_before_change` | No | Docs to read before planning |
| `build_order` | No | Order of work inside a ticket |
| `done` | No | Docs that must change with the code |
| `commit` | No | Commit message pattern |
| `hard_rules` | No | Never-do list |
| `permissions` | No | Overrides, see below |

## Permissions

Each is `allow`, `ask` or `deny`.

| Operation | Default |
|---|---|
| `push_ticket_branch` | `ask` |
| `open_pr` | `ask` |
| `tracker_write` | `ask` |
| `push_base` | `deny` |
| `merge` | `deny` |
| `force_push` | `deny` |
| `destructive_history` | `deny` |

`custom` adds project rules, matched as a regular expression on each command:

```yaml
permissions:
  custom:
    - name: reset_database
      pattern: migrate reset
      policy: deny
```

The strictest match wins. A gate with `agent_may_run: false` is denied to the agent automatically. A config the guard can't read makes every command ask.

Add `.ship/runs/` and `.ship/approvals/` to `.gitignore`.
