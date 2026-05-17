import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTaskStatus } from '../src/index.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmeshkit-task-status-lib-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('TaskStatusStore library API', () => {
  it('rejects status() when there is no current task', async () => {
    const root = path.join(tempDir, '.codex-team');
    const taskStatus = createTaskStatus({ root });

    await expect(taskStatus.status()).rejects.toThrow(
      `No current task status found at ${path.join(root, 'current-task.json')}. Run start first.`,
    );
  });

  it('allows finish without a current task and creates a completed status', async () => {
    const root = path.join(tempDir, '.codex-team');
    const taskStatus = createTaskStatus({ root });

    const result = await taskStatus.finish({
      task: 'Ad hoc completion',
      runId: 'finish-without-current',
      summary: 'Completed from an empty state.',
      now: '2026-05-18T01:00:00.000Z',
    });

    expect(result.state).toMatchObject({
      runId: 'finish-without-current',
      task: 'Ad hoc completion',
      status: 'Done',
      summary: 'Completed from an empty state.',
      next: 'Human review.',
      tests: [],
      screenshots: [],
      risks: [],
    });
    expect(result.state.startedAt).toBe('2026-05-18T01:00:00.000Z');
    expect(result.state.finishedAt).toBe('2026-05-18T01:00:00.000Z');

    const currentJson = JSON.parse(await fs.readFile(path.join(root, 'current-task.json'), 'utf8'));
    const events = await readEvents(root, 'finish-without-current');
    expect(currentJson).toMatchObject({ runId: 'finish-without-current', status: 'Done' });
    expect(events.map((event) => event.event)).toEqual(['finished']);
  });

  it('allows fail without a current task and creates a Needs Human status', async () => {
    const root = path.join(tempDir, '.codex-team');
    const taskStatus = createTaskStatus({ root });

    const result = await taskStatus.fail({
      task: 'Ad hoc failure',
      runId: 'fail-without-current',
      reason: 'Blocked before start.',
      now: '2026-05-18T02:00:00.000Z',
    });

    expect(result.state).toMatchObject({
      runId: 'fail-without-current',
      task: 'Ad hoc failure',
      status: 'Needs Human',
      summary: 'Blocked before start.',
      next: 'Human intervention required.',
    });
    expect(result.state.startedAt).toBe('2026-05-18T02:00:00.000Z');
    expect(result.state.finishedAt).toBe('2026-05-18T02:00:00.000Z');

    const events = await readEvents(root, 'fail-without-current');
    expect(events.map((event) => event.event)).toEqual(['failed']);
    expect(events[0]).toMatchObject({
      event: 'failed',
      runId: 'fail-without-current',
      status: 'Needs Human',
      payload: { summary: 'Blocked before start.', next: 'Human intervention required.' },
    });
  });

  it('appends notified events when a notifier succeeds', async () => {
    const root = path.join(tempDir, '.codex-team');
    const notifications: Array<{ event: string; text: string }> = [];
    const taskStatus = createTaskStatus({
      root,
      notifier: async ({ event, text }) => {
        notifications.push({ event, text });
        return { provider: 'memory', messageId: 'message-1' };
      },
    });

    await taskStatus.start({ runId: 'notify-success', task: 'Notify success' });
    const result = await taskStatus.finish({ summary: 'Notify operator.' });

    expect(result.notification).toEqual({ ok: true, result: { provider: 'memory', messageId: 'message-1' } });
    expect(notifications).toEqual([
      {
        event: 'finished',
        text: expect.stringContaining('Agent task finished'),
      },
    ]);

    const events = await readEvents(root, 'notify-success');
    expect(events.map((event) => event.event)).toEqual(['started', 'finished', 'notified']);
    expect(events[2]).toMatchObject({
      event: 'notified',
      payload: {
        event: 'finished',
        result: { provider: 'memory', messageId: 'message-1' },
      },
    });
  });

  it('appends notification_failed events when a notifier fails', async () => {
    const root = path.join(tempDir, '.codex-team');
    const taskStatus = createTaskStatus({
      root,
      notifier: {
        notify() {
          throw new Error('adapter unavailable');
        },
      },
    });

    await taskStatus.start({ runId: 'notify-failure', task: 'Notify failure' });
    const result = await taskStatus.fail({ reason: 'Need credentials.' });

    expect(result.notification).toMatchObject({
      ok: false,
      error: { name: 'Error', message: 'adapter unavailable' },
    });

    const events = await readEvents(root, 'notify-failure');
    expect(events.map((event) => event.event)).toEqual(['started', 'failed', 'notification_failed']);
    expect(events[2]).toMatchObject({
      event: 'notification_failed',
      payload: {
        event: 'failed',
        error: { name: 'Error', message: 'adapter unavailable' },
      },
    });
  });

  it('uses custom renderMarkdown and renderNotificationMessage overrides', async () => {
    const root = path.join(tempDir, '.codex-team');
    const notifications: string[] = [];
    const taskStatus = createTaskStatus({
      root,
      renderMarkdown: (state) => `# Custom heading\n\n- Run: ${state.runId}\n- Task: ${state.task}\n`,
      renderNotificationMessage: (event, state) => `[custom ${event}] ${state.runId}`,
      notifier: ({ text }) => {
        notifications.push(text);
        return { ok: true };
      },
    });

    await taskStatus.start({
      task: 'Override smoke',
      runId: 'override-run',
      summary: 'Started with overrides.',
    });
    await taskStatus.finish({ summary: 'Done with overrides.', notify: true });

    const currentMd = await fs.readFile(path.join(root, 'current-task.md'), 'utf8');
    const runMd = await fs.readFile(path.join(root, 'runs/override-run/status.md'), 'utf8');
    expect(currentMd).toContain('# Custom heading');
    expect(currentMd).toContain('- Task: Override smoke');
    expect(currentMd).not.toContain('# Current Agent Task');
    expect(runMd).toContain('# Custom heading');

    expect(notifications).toEqual(['[custom finished] override-run']);
  });
});

async function readEvents(root: string, runId: string): Promise<Array<Record<string, unknown>>> {
  return (await fs.readFile(path.join(root, 'runs', runId, 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
