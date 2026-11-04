# AdonisJS Flow review

The GitHub Action of the [AdonisJS Flow](https://github.com/apps/adonisjs-flow) review. It reviews a pull request with the review lenses of Flow, in your own GitHub Actions, on your own Anthropic API key or Claude subscription.

The Flow App starts this workflow for each pull request it reviews. You do not run it by hand.

## Usage

Add `.github/workflows/flow-review.yml` to the default branch of your repository:

```yaml
name: Flow review

on:
  workflow_dispatch:
    inputs:
      payload:
        description: Sent by the Flow App. Do not edit.
        required: true

permissions:
  contents: read
  id-token: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24

      # Your own install. Change it to suit your project.
      - run: npm ci

      - run: npx flow install --ci

      - uses: adonisjs-plus/flow-review-action@v0.4.1
        with:
          payload: ${{ inputs.payload }}
        env:
          CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          # or ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Versions

Each release of the Action has its own tag, such as `v0.4.1`, and a tag never moves. Use the tag of a release, as the workflow above does. To get a new reviewer, change the tag. The [tags](https://github.com/adonisjs-plus/flow-review-action/tags) list each release.

Dependabot can open the pull request that changes the tag when a new release comes out:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

## Inputs

| Input | Description |
| --- | --- |
| `payload` | The payload that the Flow App sends. Pass `inputs.payload` as it is. Required |
| `max-budget` | Stop the review when its model cost reaches this many US dollars. Default `5` |
| `working-directory` | The folder of the app, where `flow.lock` is. Default: the root of the repository |
