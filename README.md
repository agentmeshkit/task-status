# @agentmeshkit/task-status

Runtime task status and notification primitives for agent teams.

This package extracts the file-backed `.codex-team` task status loop used by
AgentWeb into a reusable TypeScript ESM library and CLI.

Use it when a long-running agent or orchestration process needs a durable,
human-readable status file, machine-readable task state, append-only events,
and optional completion notifications without adding a database.

## Install

```bash
pnpm add @agentmeshkit/task-status
```

## CLI

```bash
agentmeshkit-task-status start \
  --task "Build feature" \
  --mode PLAN_FIRST \
  --summary "Starting research."

agentmeshkit-task-status update \
  --status Testing \
  --summary "Implementation complete; running gates." \
  --test "pnpm typecheck: PASS"

agentmeshkit-task-status finish \
  --summary "Done." \
  --test "pnpm build: PASS" \
  --risk "Live dispatch was not exercised."

agentmeshkit-task-status status --json
```

Use `--root <path>` to write somewhere other than `.codex-team`. Every
mutating command prints a small JSON result with `ok`, `command`, `runId`,
`status`, and the current Markdown path. `status` prints Markdown by default;
use `status --json` for the complete `TaskState`.

Lifecycle behavior:

- `start` creates a new current task and run directory. Defaults:
  `status: "Researching"` and `mode: "PLAN_FIRST"`.
- `update` requires an existing current task and rewrites the current snapshot.
  If a task had been finished, `update` removes `finishedAt` to reopen it.
- `finish` marks the task `Done`. If no current task exists, it creates a
  completion snapshot.
- `fail` marks the task `Needs Human`. `--reason` is used as the summary when
  `--summary` is not provided.
- `--test`, `--screenshot`, and `--risk` are repeatable.

The stock CLI is intentionally local-file only. `--notify` is accepted for
API parity, but notifications require a configured library notifier; build a
small wrapper around the library when a CLI workflow needs transport delivery.

The CLI writes:

```text
.codex-team/current-task.md
.codex-team/current-task.json
.codex-team/runs/<run-id>/status.md
.codex-team/runs/<run-id>/status.json
.codex-team/runs/<run-id>/events.jsonl
```

## Library

```ts
import { createTaskStatus } from '@agentmeshkit/task-status';

const taskStatus = createTaskStatus({
  root: '.codex-team',
  notifier: async ({ text }) => {
    await sendToYourMessageBus(text);
  },
});

await taskStatus.start({
  task: 'Build feature',
  mode: 'PLAN_FIRST',
  summary: 'Starting research.',
});

await taskStatus.update({
  status: 'Testing',
  summary: 'Running local gates.',
  tests: ['pnpm test: PASS'],
});

await taskStatus.finish({
  summary: 'Done.',
  notify: true,
});
```

Top-level helpers are also exported:

```ts
import { start, update, finish, fail, status } from '@agentmeshkit/task-status';

await start({ task: 'Build feature' }, { root: '.codex-team' });
await update({ status: 'Testing', summary: 'Running checks.' }, { root: '.codex-team' });
await finish({ summary: 'Done.' }, { root: '.codex-team' });
```

`createTaskStatus` also accepts `cwd` for Git branch/commit discovery and
optional `renderMarkdown` / `renderNotificationMessage` overrides for callers
that need legacy formatting while keeping the same file and event behavior.

## Notifications

Notifications are intentionally transport-agnostic. Pass a `notifier` object or
function to `createTaskStatus`; the package does not depend on Telegram or any
other vendor. Notifier failures are recorded in `events.jsonl` and do not
prevent local status files from being written.

Notification defaults are event-specific:

- `start` and `update` notify only when the input includes `notify: true`.
- `finish` and `fail` attempt notification by default when a notifier is
  configured. Pass `notify: false` to suppress that attempt.

Adapter example:

```ts
import { createTaskStatus, type TaskNotification } from '@agentmeshkit/task-status';

async function postToWebhook(notification: TaskNotification) {
  const response = await fetch(process.env.TASK_STATUS_WEBHOOK_URL!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event: notification.event,
      runId: notification.state.runId,
      status: notification.state.status,
      text: notification.text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Webhook notification failed with HTTP ${response.status}`);
  }

  return { provider: 'webhook', status: response.status };
}

const taskStatus = createTaskStatus({
  root: '.codex-team',
  notifier: { notify: postToWebhook },
});

await taskStatus.fail({ reason: 'Blocked by missing approval.', notify: true });
```

The notifier receives `{ event, state, text }`. `text` comes from
`renderNotificationMessage(event, state)` unless a custom renderer is provided.
The return value from the notifier is sanitized before being appended to
`events.jsonl`.

## File Format Contract

`task-status` treats the state directory as a durable interchange format:

```text
.codex-team/current-task.md
.codex-team/current-task.json
.codex-team/runs/<run-id>/status.md
.codex-team/runs/<run-id>/status.json
.codex-team/runs/<run-id>/events.jsonl
```

`current-task.json` and `runs/<run-id>/status.json` are the same complete
snapshot. They use this schema:

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

Timestamps are ISO 8601 strings. `status` accepts the built-in lifecycle names
and custom strings. `finishedAt` is present only after `finish` or `fail`;
`update` removes it when reopening a task.

`current-task.md` and `runs/<run-id>/status.md` are the same rendered Markdown
view of the snapshot. Consumers should read JSON for automation and Markdown
for human display.

`events.jsonl` is append-only JSON Lines. Each line has:

```ts
interface TaskEvent {
  at: string;
  event: 'started' | 'updated' | 'finished' | 'failed' | 'notified' | 'notification_failed';
  runId: string;
  status: string;
  payload: unknown;
}
```

Event payloads are redacted before write: sensitive environment values and
sensitive-looking object keys such as `token`, `secret`, `password`, `apiKey`,
`auth`, `cookie`, and `credential` are replaced with `[REDACTED]`.

Redaction is deliberately scoped to event payloads and notifier results. The
state snapshot, Markdown rendering, and outbound notification text are written
from caller-provided fields. Do not place secrets, credentials, private URLs,
customer data, or other sensitive values in `task`, `summary`, `next`, `tests`,
`screenshots`, or `risks`.

For compact agent-facing instructions, see
[`docs/AI_AGENT_INTEGRATION.md`](docs/AI_AGENT_INTEGRATION.md).

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```
