---
# A three-repo product with a doc-heavy process. The root folder is not a git
# repo, so this file lives at api/.ship/config.md.
version: 1
repos:
  - name: api
    path: .
    base: develop
  - name: flow
    path: ../flow
    base: develop
  - name: mobile
    path: ../mobile
    base: develop
tracker:
  kind: files
  path: docs/work
specs:
  path: docs/work/specs
  acceptance_id: AC-<AREA>-NN
read_before_change:
  - ../CLAUDE.md
  - docs/prd/README.md
  - docs/prd/01-invariants.md
  - "docs/prd/features/<feature>.md, especially section 9 Regression traps and section 10 Locked decisions"
  - docs/contracts/00-conventions.md
gates:
  - repo: api
    name: lint
    command: pnpm lint
    agent_may_run: true
  - repo: api
    name: build
    command: pnpm build
    agent_may_run: true
  - repo: api
    name: test
    command: pnpm test
    agent_may_run: false
  - repo: flow
    name: typecheck
    command: pnpm typecheck
    agent_may_run: true
  - repo: flow
    name: build
    command: pnpm build
    agent_may_run: true
  - repo: mobile
    name: typecheck
    command: npx tsc --noEmit
    agent_may_run: true
  - repo: mobile
    name: lint
    command: npm run lint
    agent_may_run: true
build_order:
  - migration
  - claim new models in the owning PRD
  - context module
  - routes on /api/v1, deleting what they replace
  - web
  - mobile
  - tests named by acceptance id
  - docs
done:
  - The feature PRD, including section 9 and section 11
  - The contract
  - ROUTES rows, regenerated with docs/_inventory/scripts/regen.sh
  - ROADMAP or track status
  - English and Arabic locale keys
branch: feature/{ticket}-{slug}
commit: "type(scope): imperative summary"
hard_rules:
  - Never run prisma db push
  - Never edit an existing migration
  - Never write another feature's models; call its service
  - Never weaken an invariant to pass a test
  - Never kill the running dev servers
permissions:
  custom:
    - name: database_push
      pattern: prisma db push
      policy: deny
    - name: database_reset
      pattern: migrate reset
      policy: deny
    - name: production_migration
      pattern: migrate:prod
      policy: deny
---
Migrations follow a clean-slate rule: one migration in the target shape, with the code it replaces deleted in the same change.
