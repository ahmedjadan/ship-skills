# Ship

Ship takes a feature from idea to pull request in Claude Code, with a workflow the agent can't skip or fake.

Most agent workflows are prompts, and a prompt can only ask. Ship pairs its skills with a small CLI and a permission hook, so that:

- An unapproved plan can't start building.
- A check counts as passed only if Ship ran it on the current commit.
- Editing something voids its approval.
- A session that dies mid-ticket resumes at the right step.
- Pushing to your base branch is blocked, not discouraged.

## Commands

| Command | What it does |
|---|---|
| `/ship:setup` | Detects your repos, checks and tracker, and writes `.ship/config.md` |
| `/ship:spec` | Interviews you and writes a spec with acceptance ids |
| `/ship:tickets` | Cuts the spec into vertical slices and publishes them |
| `/ship:implement` | Builds the next unblocked ticket from an approved plan, or resumes one |
| `/ship:review` | Reviews standards and spec separately, and checks every acceptance id has a test |
| `/ship:pr` | Opens cross-linked PRs whose verification section comes from recorded evidence |

You approve the spec, ticket breakdown, plan, review and PR. Everything else runs on its own.

## Install

Requires Claude Code and Node 20 or later.

```text
/plugin marketplace add ahmedjadan/ship-skills
/plugin install ship@ship-skills
```

Then run `/ship:setup` in your project.

To try a local checkout:

```bash
claude --plugin-dir /path/to/ship-skills
```

## Trackers

| Tracker | Runs through | Status |
|---|---|---|
| `files`: markdown in your repo, no account | CLI | Tested |
| `github`: issues, via `gh` | CLI | Tested against a fake `gh` |
| `linear` | Your Linear MCP connection | **Unverified** |
| `custom`: write an adapter for Jira or anything else | Agent | See the [contract](references/tracker-contract.md) |

## How it holds together

| Part | Role |
|---|---|
| [Protocol](references/protocol.md) | The rules: lifecycle, checkpoints, evidence |
| `.ship/config.md` | Your project's facts: repos, gates, permissions, hard rules. See the [reference](references/config-schema.md) and a [multi-repo example](examples/siteflow.config.md) |
| `bin/ship.mjs` | The only writer of state. It refuses illegal moves |
| `hooks/hooks.json` | Applies your `allow`, `ask` and `deny` permissions to commands |
| Skills | Guide the agent through the work |

Some checks belong to you, such as tests against a shared database. Mark a gate `agent_may_run: false` and the agent can't run it. It hands you the command, and the PR lists the gate under **Not run** unless you report a result, which is labelled as your report.

## What it does not protect against

- **The hook is a guardrail, not a sandbox.** It reads command text, so a script that pushes internally or a deliberately obfuscated command will get past it. Use branch protection on your remote as well.
- **Approvals are an audit trail, not proof.** An agent is told to record only your real reply, and the quote is kept, but the CLI can't verify who typed it.
- **Evidence shows a command exited 0.** It says nothing about how good your tests are.
- **Agent-run trackers can drift.** For `linear` and `custom`, Ship can't read the tracker on resume.
- **The hook only sees Bash and file-edit tools.** Actions through MCP tools, such as Linear writes, aren't checked.

## Development

```bash
npm test
```

No dependencies. MIT licensed.
