# AI Agent Integration

Compact contract for agents integrating `@agentmeshkit/task-status`.

## When To Use

Use this package when an agent, runner, or supervisor must publish durable task
progress for humans and other agents. Prefer JSON for automation and Markdown
for human display.

## Library Pattern

```ts
import { createTaskStatus } from '@agentmeshkit/task-status';

const taskStatus = createTaskStatus({ root: '.codex-team' });

await taskStatus.start({
  task: 'Implement feature',
  mode: 'PLAN_FIRST',
  summary: 'Reading the codebase.',
});

await taskStatus.update({
  status: 'Testing',
  summary: 'Implementation done; running checks.',
  tests: ['pnpm test: PASS'],
});

await taskStatus.finish({
  summary: 'Done.',
  next: 'Human review.',
  risks: ['No live deployment exercised.'],
});
```

Top-level helpers also exist:

```ts
import { start, update, finish, fail, status } from '@agentmeshkit/task-status';
```

Pass `{ root: '.codex-team' }` as the second argument to top-level helpers when
the default state directory is not correct.

## CLI Pattern

```sh
agentmeshkit-task-status start --task "Build feature" --summary "Starting"
agentmeshkit-task-status update --status Testing --summary "Running tests"
agentmeshkit-task-status finish --summary "Done" --test "pnpm test: PASS"
agentmeshkit-task-status status --json
```

Use `--root <path>` to write outside `.codex-team`. Mutating commands print a
small JSON result. `status` prints Markdown unless `--json` is set.

Useful repeatable fields:

- `--test "command: PASS|FAIL|not run"`
- `--screenshot "path/or/url"`
- `--risk "remaining concern"`

## File Contract

```text
.codex-team/current-task.md
.codex-team/current-task.json
.codex-team/runs/<run-id>/status.md
.codex-team/runs/<run-id>/status.json
.codex-team/runs/<run-id>/events.jsonl
```

`current-task.json` and `runs/<run-id>/status.json` contain the same snapshot:

```ts
interface TaskState {
  runId: string;
  task: string;
  status: string;
  mode: string;
  branch: string;
  commit: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  summary: string;
  next: string;
  tests: string[];
  screenshots: string[];
  risks: string[];
}
```

`current-task.md` and `runs/<run-id>/status.md` are the same rendered view.
`events.jsonl` is append-only JSON Lines with `started`, `updated`, `finished`,
`failed`, `notified`, and `notification_failed` events.

## Notifications

```ts
const taskStatus = createTaskStatus({
  root: '.codex-team',
  notifier: async ({ text, state, event }) => {
    await postMessage({ text, runId: state.runId, event });
  },
});
```

Notifier failures are recorded and do not block status file writes. `start` and
`update` notify only with `notify: true`; `finish` and `fail` notify by default
when a notifier exists unless `notify: false` is passed.

The stock CLI has no built-in notifier transport. Use the library or a wrapper
CLI when notifications must be delivered to Telegram, Slack, webhooks, or an
internal message bus.

## Status Values

Built-in statuses include:

- `Researching`
- `Planning`
- `Building`
- `Testing`
- `Browser Verification`
- `Review`
- `Deployment`
- `Done`
- `Needs Human`

Custom strings are allowed.

## Redaction Rules

Event payloads and notifier return values are redacted before they are appended
to `events.jsonl`. Redaction covers sensitive-looking keys such as `token`,
`secret`, `password`, `apiKey`, `auth`, `cookie`, `credential`, and `private`,
plus sensitive environment values.

State fields and notification text are not a secret store. Do not write secrets,
customer data, private tokens, auth headers, or sensitive URLs into `task`,
`summary`, `next`, `tests`, `screenshots`, or `risks`.

## Agent Rules

- Call `start()` before `update()` unless intentionally updating an existing
  state directory.
- Use `finish()` for success and `fail()` for blocked/stopped work.
- Keep `summary` factual and current; keep `next` actionable.
- Include executed checks in `tests`, including skipped or failed checks.
- Include unresolved concerns, manual follow-ups, and verification gaps in
  `risks`.
- Use `screenshots` for paths or URLs that prove browser/UI verification.
- Do not use notifier errors to decide whether local status was written; inspect
  `result.notification`.
