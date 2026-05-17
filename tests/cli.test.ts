import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(repoRoot, 'dist/cli.js');

let tempDir: string;

beforeAll(async () => {
  await execFileAsync('pnpm', ['build'], { cwd: repoRoot });
});

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmeshkit-task-status-cli-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('agentmeshkit-task-status CLI', () => {
  it('smoke tests start, update, status, finish, and fail commands', async () => {
    const root = path.join(tempDir, '.codex-team');

    const start = await runCli([
      'start',
      '--root',
      root,
      '--run-id',
      'cli-run',
      '--task',
      'CLI smoke',
      '--summary',
      'Started',
    ]);
    expect(start).toMatchObject({ ok: true, command: 'start', runId: 'cli-run', status: 'Researching' });

    const update = await runCli([
      'update',
      '--root',
      root,
      '--status',
      'Testing',
      '--summary',
      'Running smoke tests',
      '--test',
      'cli smoke: PASS',
    ]);
    expect(update).toMatchObject({ ok: true, command: 'update', runId: 'cli-run', status: 'Testing' });

    const status = await runCli(['status', '--root', root, '--json']);
    expect(status).toMatchObject({
      runId: 'cli-run',
      task: 'CLI smoke',
      status: 'Testing',
      tests: ['cli smoke: PASS'],
    });

    const finish = await runCli(['finish', '--root', root, '--summary', 'Finished']);
    expect(finish).toMatchObject({ ok: true, command: 'finish', runId: 'cli-run', status: 'Done' });

    const failRoot = path.join(tempDir, '.codex-team-fail');
    const fail = await runCli(['fail', '--root', failRoot, '--reason', 'Blocked']);
    expect(fail).toMatchObject({ ok: true, command: 'fail', status: 'Needs Human' });

    await expect(fs.stat(path.join(root, 'current-task.md'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, 'current-task.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, 'runs/cli-run/status.md'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, 'runs/cli-run/events.jsonl'))).resolves.toBeTruthy();
  });
});

async function runCli(args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], { cwd: tempDir });
  return JSON.parse(stdout);
}
