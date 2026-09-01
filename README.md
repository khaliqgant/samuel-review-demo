# samuel-review — demo

A review relayflow that reviews a diff the way **you** review, plus a narrow
security pass, and leaves every step's output on disk so you can see exactly
what ran and why. Nothing merges, nothing comments on GitHub, nothing is hidden.

This repo exists so you can watch it work before pointing it at anything real:
it contains one deliberately-flawed PR (`pr/connection-token-refresh` vs `main`)
that trips most of the things you flag in review.

---

## What you need

- **Node 20+** (built and verified on 22).
- **codex**, logged in. That's the only agent CLI this uses — there is no Claude
  anywhere in it, on purpose. Check with `codex login status`.
- Nothing else. No Slack, no tokens, no relay account, no cloud.

## Install

```bash
npm install
```

## Run it on the demo PR

The flow reviews `HEAD` against a base branch (default `main`). The demo repo is
already checked out on the PR branch, so:

```bash
npx tsx samuel-review.ts
```

Then read the result:

```bash
cat .samuel-review/SUMMARY.md
```

You'll also see every step announced live as it runs (capture-diff → checks →
the two review lanes in parallel → summary). That live log + the files under
`.samuel-review/` are the "what step ran, and what did it decide" view.

### Output layout

```
.samuel-review/
  diff.patch    what was reviewed (commit list + git diff BASE...HEAD)
  checks.txt    lint / typecheck / test / build output, captured as evidence
  samuel.md     YOUR lane's review + a SAMUEL: PASS|CHANGES verdict line
  security.md   the security lane's review + a SECURITY: CLEAR|RISK verdict line
  SUMMARY.md    the two reviews on one page — read this first
```

## Run it on a real PR (your repo)

You do **not** need to install anything into your repo. Install this tool once
(the `npm install` above), then point it at any checkout — `tsx` resolves
`@relayflows/core` from *this* folder, while the review runs against your
current directory:

```bash
cd ~/your-repo
git checkout the-pr-branch
BASE=main ~/samuel-review-demo/node_modules/.bin/tsx ~/samuel-review-demo/samuel-review.ts
```

`BASE` = what the PR merges into. Using the demo's own `.bin/tsx` (not `npx tsx`)
keeps it non-interactive — no install prompt in a repo that has no `tsx`.

Your repo only needs `codex` and `git` on PATH. The flow only reads — it never
pushes, commits, or posts.

**One-time: ignore the output.** The run writes `.samuel-review/`,
`.agent-relay/`, and `.agentworkforce/` (trajectories + run state) into the
directory you run in. Add these to your repo's `.gitignore`:

```gitignore
.samuel-review/
.agent-relay/
.agentworkforce/
```

(Prefer to vendor it instead? Copy `samuel-review.ts` into your repo,
`npm i -D @relayflows/core tsx`, add the three ignore lines, then
`npx tsx samuel-review.ts`.)

> One edit before a real repo: the `checks` step in `samuel-review.ts` runs
> generic `npm run lint / tsc --noEmit / npm test / npm run build`. Point those
> four commands at whatever your repo actually uses. A failing check is not a
> problem — it's captured as evidence and handed to the reviewer, not treated as
> a crash.

## Make it actually *you*

Open `samuel-review.ts` and edit the `SAMUEL_STANDARDS` array near the top. It's
seeded from an audit of your review comments on ~60 NangoHQ/nango PRs
(#1269–#1760 and later) — each line is anchored to a real comment you left. Add,
delete, reword. That list *is* the reviewer; the more it sounds like you, the
better the lane reads.

## Tweaking the flow itself (add a lane, change the gates, etc.)

Editing `SAMUEL_STANDARDS` needs nothing. If you want to go further — add a
review lane, change how the diff is captured, wire in a human approval gate —
load the authoring skill and let your agent write the changes against the real
contract instead of guessing the API:

```bash
npx skills add https://github.com/agentworkforce/skills --skill writing-agent-relay-workflows
```

It covers the `@relayflows/core` builder, DAG steps, `{{steps.X.output}}`
chaining, verification gates, and the gotchas (why a step swallows output, the
codex model note, etc.). With it loaded, "add a performance lane to
samuel-review.ts" is a one-line ask.

## Why it's built the way it is

- **A `CHANGES` / `RISK` verdict is a good outcome, not a failed run.** The lanes
  always finish and write their verdict to a file; the run does not hard-fail on
  a finding, so a real catch is never buried under a red "step failed" with no
  output. That buried-output behaviour is the exact thing you said drives you
  nuts about the review bots today.
- **Every step leaves a file, and trajectories are on** — so "why did (or didn't)
  this fire?" is answerable after the fact, not a black box.
- **The security lane is deliberately narrow and quiet** — security only, silent
  unless there's something real. Not a pedantic everything-bot.
- **codex / gpt-5.5 throughout.** (On a ChatGPT account, `gpt-5.3-codex` returns
  a 400 — `gpt-5.5` is the default and is what this uses.)

## Alternate runner

`npx tsx samuel-review.ts` is the simplest. If you'd rather use the relayflows
CLI: `npx relayflows run samuel-review.ts` (validate first with
`npx relayflows run --dry-run samuel-review.ts`).
