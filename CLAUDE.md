# Development Workflow

- NEVER commit directly to `main`. Always create a feature branch first.
- Branch protection is enabled — pushes to `main` will be rejected.
- Flow: feature branch → PR to main → merge → auto-deploy staging → approve → production
- Deploys are managed by the centralized orchestrator at github.com/mnemom/deploy
- If you accidentally started work on main, recover with:
  ```bash
  git checkout -b fix/your-description
  git push -u origin fix/your-description
  gh pr create --base main
  ```
