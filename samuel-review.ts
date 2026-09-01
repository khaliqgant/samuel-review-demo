/**
 * samuel-review — a review relayflow you can actually READ.
 * ----------------------------------------------------------------------------
 * Built for Samuel (Lovable) after the 1 Sep call. Two things he said drove
 * every choice in this file:
 *
 *   1. "I'm constantly [opening] issues where I don't understand why some rules
 *       were [applied] or not. What is executed? ... having something that you
 *       could actually see — debug, what step was executed at which point —
 *       would be nice for sure."
 *   2. "I've been postponing writing my own agent ... I need to write down what
 *       defines me as a reviewer."
 *
 * So this flow does exactly that and nothing else. It reviews a diff through a
 * couple of small, named lanes, and every lane leaves a file behind. Nothing is
 * hidden, nothing is swallowed, nothing merges anything. You run it, you read
 * the output, you see which step said what and why.
 *
 *   capture-diff ─▶ checks (lint/type/test/build) ─┐
 *                └▶ review-samuel  (YOUR taste)   ─┼─▶ summary  (one screen)
 *                └▶ review-security (narrow, high-signal) ─┘
 *
 * Tailored to how you actually work:
 *   - Every agent is codex / gpt-5.5. You said you hate Claude and live in
 *     Cursor/Codex, so there's no Claude anywhere in here.
 *   - The security lane is deliberately narrow and quiet — like your "death"
 *     bot — not a pedantic everything-bot that misses the critical thing.
 *   - A lane that FAILS is a good outcome (it found something), not a crashed
 *     run. Lanes always exit 0 and write their verdict to a file; the run does
 *     NOT hard-fail on a FAIL, so a real finding is never buried under a red
 *     "step failed" with no output. That buried-output thing is the exact
 *     frustration you described.
 *
 * Run it from the root of the repo/branch you want reviewed:
 *   npm install
 *   npx relayflows run --dry-run samuel-review.ts          # validate, no agents
 *   npx relayflows run samuel-review.ts                    # review HEAD vs main
 *   BASE=develop npx relayflows run samuel-review.ts       # review HEAD vs develop
 *
 * Output lands in ./.samuel-review/  (diff.patch, checks.txt, samuel.md,
 * security.md, SUMMARY.md). Read SUMMARY.md first.
 */
import {
  CodexModels,
  WorkflowRunner,
  createDefaultEventLogger,
  formatDryRunReport,
  workflow,
} from '@relayflows/core';

/** Branch/ref to diff HEAD against. Your PR base. */
const BASE = process.env.BASE ?? 'main';

/** Where every step leaves its readable trail. */
const OUT = '.samuel-review';

/**
 * YOUR reviewer, distilled from how you ACTUALLY review. This is the "write
 * down what defines me as a reviewer" block you've been putting off — except
 * it's already seeded, from an audit of your review comments across ~60
 * NangoHQ/nango PRs (#1269–#1760, plus later ones). Each line is anchored to a
 * real comment you left, so this is your Samuel-bot, not a generic linter.
 *
 * Edit freely — the list IS the reviewer. The through-line the audit found:
 * you consistently review for *legibility and debuggability* (surfaced errors,
 * flat control flow, honest names, small diffs) — the same thing you said the
 * review bots take away from you.
 */
const SAMUEL_STANDARDS: string[] = [
  'Errors are checked and surfaced, never swallowed — a hidden error just moves the pain to debugging later. ("isn\'t that making debugging harder?", #1673/#1729)',
  'Flat over nested: prefer early returns to deep nesting, it is hard to read. (#1697)',
  'Naming & consistency: no mixed camelCase/snake_case in one object, no redundant prefixes (config_id), names say what they are. (#1697)',
  'Magic values and inline expressions are pulled into named vars/consts. (#1701)',
  'Validation goes through a schema (zod), not hand-rolled checks. (#1742)',
  'Tests run independently — no test leaning on another test\'s side effect. (#1662)',
  'Is the PR small enough to review at all? If not, say "split this". (#1730)',
  'Explicit over clever, and tighten the types — fewer footguns, especially on public API/SDK. ("as strict as possible", #1684/#4611)',
  // TODO(Samuel): add anything the audit missed. This list is the whole point.
];

async function runWorkflow(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run') || !!process.env.DRY_RUN;

  const builder = workflow('samuel-review')
    .description(
      'Review a diff through small, named, fully-legible lanes. Every step ' +
        'leaves a file; nothing merges, nothing is hidden.',
    )
    .pattern('dag')
    .channel('wf-samuel-review')
    .maxConcurrency(2) // the two review lanes are the only parallel wave
    .timeout(1_800_000) // 30 min

    // Your reviewer — the persona you've been meaning to write down.
    .agent('samuel', {
      cli: 'codex',
      model: CodexModels.GPT_5_5,
      preset: 'reviewer',
      role:
        'Reviews a diff the way Samuel reviews: correctness and taste over ' +
        'style nits. Explains WHY, never rubber-stamps.',
    })
    // Narrow, quiet security pass — modelled on your dedicated security bot.
    .agent('security', {
      cli: 'codex',
      model: CodexModels.GPT_5_5,
      preset: 'reviewer',
      role:
        'Security ONLY. Ignores UX/style. Stays silent unless there is a real ' +
        'security issue — high signal, low noise.',
    })

    // ── Capture the diff + commit intent once, hand it to both lanes ─────────
    // `git diff BASE...HEAD` is the PR diff. We also dump the short log so the
    // reviewer sees whatever intent the commits carry — you said intent is the
    // thing that goes missing, so at least surface what's there.
    .step('capture-diff', {
      type: 'deterministic',
      command: [
        'set -e',
        `mkdir -p ${OUT}`,
        `echo "=== ${BASE}...HEAD ===" > ${OUT}/diff.patch`,
        `git log --oneline ${BASE}...HEAD >> ${OUT}/diff.patch 2>/dev/null || true`,
        `echo "" >> ${OUT}/diff.patch`,
        `git diff ${BASE}...HEAD >> ${OUT}/diff.patch`,
        `echo "captured $(wc -l < ${OUT}/diff.patch) lines"`,
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // ── Deterministic checks: the boring truth, captured not gated ───────────
    // failOnError:false so a red build/test becomes EVIDENCE the reviewer reads,
    // not a dead run. Point these at your repo's real commands.
    .step('checks', {
      type: 'deterministic',
      dependsOn: ['capture-diff'],
      command: [
        `echo "=== checks (edit for your repo) ===" | tee ${OUT}/checks.txt`,
        `(npm run -s lint       2>&1 || echo "LINT FAILED")      | tee -a ${OUT}/checks.txt`,
        `(npx tsc --noEmit      2>&1 || echo "TYPECHECK FAILED") | tee -a ${OUT}/checks.txt`,
        `(npm test -s           2>&1 || echo "TESTS FAILED")     | tee -a ${OUT}/checks.txt`,
        `(npm run -s build      2>&1 || echo "BUILD FAILED")     | tee -a ${OUT}/checks.txt`,
      ].join(' && '),
      captureOutput: true,
      failOnError: false,
    })

    // ── Your lane ────────────────────────────────────────────────────────────
    .step('review-samuel', {
      agent: 'samuel',
      dependsOn: ['checks'],
      task: [
        `Review the diff in ${OUT}/diff.patch. The deterministic check output is`,
        `in ${OUT}/checks.txt — read it, do not re-run the checks.`,
        '',
        'Apply THESE standards (this is the point — they are the reviewer):',
        ...SAMUEL_STANDARDS.map((s, i) => `  ${i + 1}. ${s}`),
        '',
        `Write your review to ${OUT}/samuel.md: findings first, each with the`,
        'file/line and WHY it matters, then the one thing you would fix before',
        'anything else. Be specific; skip style nits unless they hide a real bug.',
        '',
        'End your response with your verdict on its OWN final line, exactly once:',
        '  `SAMUEL: PASS` — you would approve as-is',
        '  `SAMUEL: CHANGES <one-line reason>` — you want changes first',
        'An empty or missing diff is an automatic CHANGES.',
      ].join('\n'),
      // The agent ran = success. A CHANGES verdict is a good result, not a
      // failure, so we gate on exit code, not on the word PASS.
      verification: { type: 'exit_code', value: '0' },
    })

    // ── Security lane ─────────────────────────────────────────────────────────
    .step('review-security', {
      agent: 'security',
      dependsOn: ['checks'], // same dep as review-samuel → the two run in parallel
      task: [
        `Security review of the diff in ${OUT}/diff.patch. Security ONLY.`,
        '',
        'Look for: injected secrets/keys, authz bypass, injection, unsafe',
        'deserialization, new outbound calls to unexpected hosts, dependency',
        'changes pulling known-vulnerable versions. Ignore everything else.',
        '',
        `Write ${OUT}/security.md. If there is nothing, say so in one line — do`,
        'not manufacture findings to look useful.',
        '',
        'End your response with your verdict on its OWN final line, exactly once:',
        '  `SECURITY: CLEAR` — no security issue',
        '  `SECURITY: RISK <one-line reason>` — a real issue to look at',
      ].join('\n'),
      verification: { type: 'exit_code', value: '0' },
    })

    // ── One screen you can actually read ──────────────────────────────────────
    // No interpolation, no quoting hazards — it just concatenates the files the
    // lanes wrote. This is the "see what each step said, in one place" payoff.
    .step('summary', {
      type: 'deterministic',
      dependsOn: ['review-samuel', 'review-security'],
      command: [
        `echo "# samuel-review — ${BASE}...HEAD" > ${OUT}/SUMMARY.md`,
        `echo "" >> ${OUT}/SUMMARY.md`,
        `echo "## Samuel" >> ${OUT}/SUMMARY.md`,
        `cat ${OUT}/samuel.md >> ${OUT}/SUMMARY.md 2>/dev/null || echo "(no samuel.md)" >> ${OUT}/SUMMARY.md`,
        `echo "" >> ${OUT}/SUMMARY.md`,
        `echo "## Security" >> ${OUT}/SUMMARY.md`,
        `cat ${OUT}/security.md >> ${OUT}/SUMMARY.md 2>/dev/null || echo "(no security.md)" >> ${OUT}/SUMMARY.md`,
        `echo "" >> ${OUT}/SUMMARY.md`,
        `echo "--- verdicts ---"`,
        `grep -hE "^(SAMUEL|SECURITY):" ${OUT}/samuel.md ${OUT}/security.md 2>/dev/null || echo "(no verdict lines found)"`,
        `echo "full review: ${OUT}/SUMMARY.md"`,
      ].join(' && '),
      captureOutput: true,
      failOnError: false,
    })

    // Trajectories on: this is the "what step ran, when, and why" record you
    // said you wanted. Every step's decisions are captured, not just its output.
    .trajectories({ enabled: true, autoDecisions: true })
    .onError('fail-fast', { maxRetries: 1, retryDelayMs: 5_000 });

  const config = builder.toConfig();
  const runner = new WorkflowRunner({ cwd: process.cwd() });

  if (dryRun) {
    console.log(formatDryRunReport(runner.dryRun(config)));
    return;
  }

  console.log(`samuel-review: reviewing ${BASE}...HEAD`);
  console.log(`  output: ${OUT}/SUMMARY.md\n`);

  runner.on(createDefaultEventLogger('normal'));
  const result = await runner.execute(config);

  if (result.status !== 'completed') {
    throw new Error(
      `Workflow finished with status ${result.status}` +
        (result.error ? `: ${result.error}` : ''),
    );
  }
  console.log(`\nsamuel-review done — read ${OUT}/SUMMARY.md`);
}

runWorkflow().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
