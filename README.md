# @agentmeshkit/task-status

Runtime task status and notification primitives for agent teams.

This package extracts the file-backed `.codex-team` task status loop used by
AgentWeb into a reusable TypeScript ESM library and CLI.

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

Use `--root <path>` to write somewhere other than `.codex-team`.

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
```

## Notifications

Notifications are intentionally transport-agnostic. Pass a `notifier` object or
function to `createTaskStatus`; the package does not depend on Telegram or any
other vendor. Notifier failures are recorded in `events.jsonl` and do not
prevent local status files from being written.

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```
