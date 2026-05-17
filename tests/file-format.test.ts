import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTaskStatus } from '../src/index.js';

let tempDir: string;
let previousSecret: string | undefined;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmeshkit-task-status-'));
  previousSecret = process.env.AGENTMESHKIT_TEST_SECRET;
  process.env.AGENTMESHKIT_TEST_SECRET = 'super-secret-token-value';
});

afterEach(async () => {
  if (previousSecret === undefined) delete process.env.AGENTMESHKIT_TEST_SECRET;
  else process.env.AGENTMESHKIT_TEST_SECRET = previousSecret;
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('file-backed task status', () => {
  it('writes current files, run files, and append-only redacted events', async () => {
    const root = path.join(tempDir, '.codex-team');
    const taskStatus = createTaskStatus({ root });

    await taskStatus.start({
      runId: 'run-1',
      task: 'Extract task status',
      status: 'Researching',
      summary: 'Starting with super-secret-token-value',
      now: '2026-05-18T00:00:00.000Z',
    });
    await taskStatus.update({
      status: 'Testing',
      summary: 'Running tests with super-secret-token-value',
      tests: ['pnpm test: PASS'],
      now: '2026-05-18T00:01:00.000Z',
    });

    const currentJson = JSON.parse(await fs.readFile(path.join(root, 'current-task.json'), 'utf8'));
    const runJson = JSON.parse(await fs.readFile(path.join(root, 'runs/run-1/status.json'), 'utf8'));
    const currentMarkdown = await fs.readFile(path.join(root, 'current-task.md'), 'utf8');
    const runMarkdown = await fs.readFile(path.join(root, 'runs/run-1/status.md'), 'utf8');
    const events = (await fs.readFile(path.join(root, 'runs/run-1/events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(currentJson).toEqual(runJson);
    expect(currentJson).toMatchObject({
      runId: 'run-1',
      task: 'Extract task status',
      status: 'Testing',
      summary: 'Running tests with super-secret-token-value',
      tests: ['pnpm test: PASS'],
    });
    expect(currentMarkdown).toEqual(runMarkdown);
    expect(currentMarkdown).toContain('# Current Agent Task');
    expect(currentMarkdown).toContain('- Status: Testing');
    expect(currentMarkdown).toContain('- pnpm test: PASS');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event: 'started', runId: 'run-1', status: 'Researching' });
    expect(events[1]).toMatchObject({ event: 'updated', runId: 'run-1', status: 'Testing' });
    expect(JSON.stringify(events)).not.toContain('super-secret-token-value');
    expect(JSON.stringify(events)).toContain('[REDACTED]');
  });

  it('records notifier failures without preventing completion writes', async () => {
    const root = path.join(tempDir, '.codex-team');
    const taskStatus = createTaskStatus({
      root,
      notifier: () => {
        throw new Error('notifier unavailable');
      },
    });

    await taskStatus.start({ runId: 'run-2', task: 'Notify failure test' });
    const result = await taskStatus.finish({ summary: 'Done despite notifier failure' });

    const currentJson = JSON.parse(await fs.readFile(path.join(root, 'current-task.json'), 'utf8'));
    const events = (await fs.readFile(path.join(root, 'runs/run-2/events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(result.notification).toMatchObject({
      ok: false,
      error: { message: 'notifier unavailable' },
    });
    expect(currentJson).toMatchObject({
      runId: 'run-2',
      status: 'Done',
      summary: 'Done despite notifier failure',
    });
    expect(events.map((event) => event.event)).toEqual(['started', 'finished', 'notification_failed']);
  });
});
