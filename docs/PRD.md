# PRD: AgentMeshKit Task Status

## Summary

`@agentmeshkit/task-status` provides a small runtime status layer for long-lived
agent tasks. It writes current task state, append-only events, completion
summaries, and optional notification payloads in a project-local directory.

## Problem

AgentWeb uses `.codex-team/current-task.md`, JSON status files, run directories,
and Telegram notifications to make long-running Codex work observable. Similar
projects need the same operational loop without copying scripts.

## Users

- Coding agents that need durable progress reporting.
- Operators monitoring unattended agent runs.
- Apps that need file-backed task state without a database dependency.

## Goals

- Provide a CLI and library API for task lifecycle updates.
- Store status in human-readable Markdown and machine-readable JSON.
- Append structured events for audit and recovery.
- Support pluggable notifiers.

## Non-Goals

- No scheduler in MVP.
- No vendor-specific notification hard dependency.
- No UI dashboard.
- No task execution engine.

## MVP Scope

- `task-status start/update/finish/fail/status` CLI.
- Library API with the same lifecycle operations.
- File layout compatible with `.codex-team`.
- Notification adapter interface.
- Redaction of environment values in event payloads.
- TypeScript ESM package exports and Vitest coverage for file formats and CLI
  smoke behavior.

## Public API Sketch

```ts
const status = createTaskStatus({ root: '.agent-team' });
await status.start({ task: 'Build feature', mode: 'PLAN_FIRST' });
await status.update({ status: 'Testing', summary: 'Running gates' });
await status.finish({ summary: 'Done', tests: ['pnpm test: PASS'] });
```

Implemented API:

```ts
import { createTaskStatus, start, update, finish, fail, status } from '@agentmeshkit/task-status';

const taskStatus = createTaskStatus({
  root: '.codex-team',
  notifier: async ({ event, state, text }) => {
    await sendMessage({ event, runId: state.runId, text });
  },
});

await taskStatus.start({ task: 'Build feature', mode: 'PLAN_FIRST' });
await taskStatus.update({ status: 'Testing', summary: 'Running gates' });
await taskStatus.finish({ summary: 'Done', tests: ['pnpm test: PASS'], notify: true });

await fail({ reason: 'Blocked by missing approval' }, { root: '.codex-team' });
await status({ root: '.codex-team' });
```

The CLI binary is `agentmeshkit-task-status`:

```bash
agentmeshkit-task-status start --task "Build feature" --mode PLAN_FIRST
agentmeshkit-task-status update --status Testing --summary "Running gates"
agentmeshkit-task-status finish --summary "Done" --test "pnpm test: PASS"
agentmeshkit-task-status fail --reason "Blocked"
agentmeshkit-task-status status --json
```

The implemented file layout is:

```text
.codex-team/current-task.md
.codex-team/current-task.json
.codex-team/runs/<run-id>/status.md
.codex-team/runs/<run-id>/status.json
.codex-team/runs/<run-id>/events.jsonl
```

`current-task.json` and `runs/<run-id>/status.json` contain the same task
snapshot. `current-task.md` and `runs/<run-id>/status.md` contain the same
human-readable rendering. `events.jsonl` is append-only and stores redacted
event payloads.

## AgentWeb Migration Notes

AgentWeb's script writes `.codex-team/current-task.*` and
`.codex-team/runs/<run-id>/...`; this package keeps that layout and the core
state fields (`runId`, `task`, `status`, `mode`, `branch`, `commit`,
`startedAt`, `updatedAt`, `finishedAt`, `summary`, `next`, `tests`,
`screenshots`, `risks`).

Telegram is not built in. AgentWeb-specific Telegram or Message Center behavior
should be implemented as a notifier adapter and passed to the library. The CLI
is transport-neutral and only writes local status files by default.

## Acceptance Criteria

- CLI can start, update, finish, and fail a task in an empty directory.
- JSON and Markdown outputs stay in sync.
- Events are append-only JSONL.
- Notifier failures do not corrupt local status.
- Docs include AgentWeb migration notes.
- `pnpm build`, `pnpm typecheck`, and `pnpm test` pass.

## Milestones

1. Extract file format and CLI shape.
2. Add library API and tests.
3. Add notifier interface and sample adapter documentation.
4. Publish `0.1.0`.
