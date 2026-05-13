# Fork Maintenance

This fork keeps GitHub automation intentionally small. The only workflow is `.github/workflows/sync-upstream.yml`, which checks the canonical OpenCode repository and opens a pull request when upstream `dev` has changes.

## Remotes

- `origin`: `https://github.com/dmitryryabkov/opencode.git`
- `upstream`: `https://github.com/anomalyco/opencode.git`

The local `upstream` remote has its push URL set to `DISABLED` to prevent accidental direct pushes to the canonical repository.

## Local Sync

Use this when you want to update the fork manually or resolve a sync conflict:

```sh
git fetch origin
git fetch upstream
git switch dev
git pull --ff-only origin dev
git switch -c upstream-sync/dev
git merge upstream/dev
git push -u origin upstream-sync/dev
```

Then open a pull request from `upstream-sync/dev` into `dev`.

## Contributing Back

Keep fork-specific work on topic branches branched from `dev`. When a change should go back to canonical OpenCode, open a pull request from that topic branch to `anomalyco/opencode:dev`. Avoid mixing upstream sync commits with feature commits in the same pull request.
