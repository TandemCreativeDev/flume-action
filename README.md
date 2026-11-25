# Flume Action

Moves [Flume](https://flume.zestdev.uk) stories and tasks as the pull requests that name them go, and checks every pull request names one.

Write `Closes CT2-32` (or `Fixes`, `Resolves`) in a pull request's description to move that story with it, or `Part of CT2-32` just to link it. Then:

| The pull request | The story in Flume |
| --- | --- |
| Opened as a draft | In progress |
| Ready for review | In review |
| Converted back to a draft | In progress |
| Merged | Done, confirmed by whoever merged it |

A task's key moves only that task, through the same steps: In progress on a draft, In review when opened for review, Done when merged. Stacked pull requests close the story when the last one linked to it merges. The Action comments on the pull request saying where each item moved. Bot pull requests, pull requests into other branches, and keys inside backticks or code blocks are ignored.

## Setting up a repository

1. **Create a token in Flume.** On the project's Settings page, under GitHub, enter the repository as `owner/name` and choose Create token. Copy it: Flume shows it once. Create one per repository, and revoke it there if it leaks.
2. **Add it to the repository** as the Actions secret `FLUME_TOKEN` (Settings, Secrets and variables, Actions).
3. **Add the workflow** as `.github/workflows/flume.yml`:

   ```yaml
   name: Flume

   on:
     pull_request:
       types: [opened, edited, reopened, synchronize, ready_for_review, converted_to_draft, closed, labeled, unlabeled]
     pull_request_review:
       types: [submitted, dismissed]

   permissions:
     contents: read
     pull-requests: write

   jobs:
     flume:
       uses: TandemCreativeDev/flume-action/.github/workflows/flume.yml@v1
       secrets:
         FLUME_TOKEN: ${{ secrets.FLUME_TOKEN }}
   ```

   Another Flume (a local one through a tunnel, say) goes in `with: { flume-url: https://... }` under `uses`.
4. **Make the ticket check required.** Protect the default branch and require the status check `flume / ticket`; it appears once the workflow has run on one pull request. Pull requests with no ticket (CI, docs, chores) take the `no-ticket` label: create it in the repository.
5. **Require an approving review** in the same rule, with no bypass. Merging confirms work done, so this stops anyone, an agent included, merging their own work unreviewed.

Each person's GitHub username goes on their Flume Settings page. A merge by someone Flume can't match leaves the story In review for a PM to confirm.

## Releases

This repository is published from Flume's own; change it there. `v1` always points at the latest compatible release.
