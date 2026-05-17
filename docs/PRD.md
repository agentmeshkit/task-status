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

## Public API Sketch

```ts
const status = createTaskStatus({ root: '.agent-team' });
await status.start({ task: 'Build feature', mode: 'PLAN_FIRST' });
await status.update({ status: 'Testing', summary: 'Running gates' });
await status.finish({ summary: 'Done', test: 'PASS' });
```

## Acceptance Criteria

- CLI can start, update, finish, and fail a task in an empty directory.
- JSON and Markdown outputs stay in sync.
- Events are append-only JSONL.
- Notifier failures do not corrupt local status.
- Docs include AgentWeb migration notes.

## Milestones

1. Extract file format and CLI shape.
2. Add library API and tests.
3. Add notifier interface and sample Telegram adapter.
4. Publish `0.1.0`.

