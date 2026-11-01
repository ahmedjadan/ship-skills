---
version: 1
repos:
  - name: app
    path: .
    base: main
tracker:
  kind: files
specs:
  path: docs/specs
gates:
  - repo: app
    name: test
    command: npm test
    agent_may_run: true
branch: feature/{ticket}-{slug}
commit: "type(scope): summary"
read_before_change: []
build_order: []
done: []
hard_rules: []
---
Project notes for the agent: anything the fields above can't express.
