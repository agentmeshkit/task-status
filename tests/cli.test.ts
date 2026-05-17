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
  it('prints JSON command results and updates markdown status files', async () => {
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

    const markdown = await fs.readFile(path.join(root, 'current-task.md'), 'utf8');
    expect(markdown).toContain('# Current Agent Task');
    expect(markdown).toContain('- Task: CLI smoke');
    expect(markdown).toContain('- Status: Testing');
    expect(markdown).toContain('Running smoke tests');
    expect(markdown).toContain('- cli smoke: PASS');

    const finish = await runCli(['finish', '--root', root, '--summary', 'Finished']);
    expect(finish).toMatchObject({ ok: true, command: 'finish', runId: 'cli-run', status: 'Done' });

    await expect(fs.stat(path.join(root, 'current-task.md'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, 'current-task.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, 'runs/cli-run/status.md'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, 'runs/cli-run/events.jsonl'))).resolves.toBeTruthy();
  });

  it('prints markdown for status by default and full state JSON with --json', async () => {
    const root = path.join(tempDir, '.codex-team');

    await runCli([
      'start',
      '--root',
      root,
      '--run-id',
      'status-run',
      '--task',
      'Status output',
      '--summary',
      'Started',
    ]);
    await runCli([
      'update',
      '--root',
      root,
      '--status',
      'Browser Verification',
      '--summary',
      'Checking rendered output',
      '--next',
      'Finish after screenshots',
      '--screenshot',
      'screenshots/status.png',
    ]);

    const { stdout: markdown } = await execFileAsync(process.execPath, [cliPath, 'status', '--root', root], {
      cwd: tempDir,
    });
    expect(markdown).toContain('# Current Agent Task');
    expect(markdown).toContain('- Task: Status output');
    expect(markdown).toContain('- Status: Browser Verification');
    expect(markdown).toContain('Checking rendered output');
    expect(markdown).toContain('- screenshots/status.png');

    const status = await runCli(['status', '--root', root, '--json']);
    expect(status).toMatchObject({
      runId: 'status-run',
      task: 'Status output',
      status: 'Browser Verification',
      summary: 'Checking rendered output',
      next: 'Finish after screenshots',
      screenshots: ['screenshots/status.png'],
    });
  });

  it('supports fail --json output and writes failed markdown state', async () => {
    const root = path.join(tempDir, '.codex-team');

    await runCli(['start', '--root', root, '--run-id', 'fail-run', '--task', 'Failure output']);
    const fail = await runCli([
      'fail',
      '--json',
      '--root',
      root,
      '--reason',
      'Blocked by missing approval',
      '--risk',
      'Cannot continue unattended.',
    ]);
    expect(fail).toMatchObject({ ok: true, command: 'fail', runId: 'fail-run', status: 'Needs Human' });

    const markdown = await fs.readFile(path.join(root, 'current-task.md'), 'utf8');
    expect(markdown).toContain('- Status: Needs Human');
    expect(markdown).toContain('- Finished:');
    expect(markdown).toContain('Blocked by missing approval');
    expect(markdown).toContain('- Cannot continue unattended.');
  });

  it('uses a stable exit code and error message when status has no current task', async () => {
    const root = path.join(tempDir, '.codex-team');

    await expect(execFileAsync(process.execPath, [cliPath, 'status', '--root', root], { cwd: tempDir })).rejects
      .toMatchObject({
        code: 1,
        stderr: expect.stringContaining(`No current task status found at ${path.join(root, 'current-task.json')}.`),
      });
  });
});

async function runCli(args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], { cwd: tempDir });
  return JSON.parse(stdout);
}
