import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_STATE_DIR = '.codex-team';

export type KnownTaskLifecycleStatus =
  | 'Researching'
  | 'Planning'
  | 'Building'
  | 'Testing'
  | 'Browser Verification'
  | 'Review'
  | 'Deployment'
  | 'Done'
  | 'Needs Human';

export type TaskLifecycleStatus = KnownTaskLifecycleStatus | (string & {});

export type TaskEventName =
  | 'started'
  | 'updated'
  | 'finished'
  | 'failed'
  | 'notified'
  | 'notification_failed';

export interface TaskState {
  runId: string;
  task: string;
  status: TaskLifecycleStatus;
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

export interface TaskEvent {
  at: string;
  event: TaskEventName;
  runId: string;
  status: TaskLifecycleStatus;
  payload: unknown;
}

export interface TaskNotification {
  event: TaskEventName;
  state: TaskState;
  text: string;
}

export interface TaskNotifier {
  notify(notification: TaskNotification): Promise<unknown> | unknown;
}

export type TaskNotifierLike =
  | TaskNotifier
  | ((notification: TaskNotification) => Promise<unknown> | unknown);

export interface TaskStatusOptions {
  root?: string;
  cwd?: string;
  notifier?: TaskNotifierLike;
}

export interface StartTaskInput {
  task?: string;
  runId?: string;
  status?: TaskLifecycleStatus;
  mode?: string;
  branch?: string;
  commit?: string;
  summary?: string;
  next?: string;
  tests?: string[];
  screenshots?: string[];
  risks?: string[];
  notify?: boolean;
  now?: Date | string;
}

export interface UpdateTaskInput {
  status?: TaskLifecycleStatus;
  mode?: string;
  summary?: string;
  next?: string;
  tests?: string[];
  screenshots?: string[];
  risks?: string[];
  notify?: boolean;
  now?: Date | string;
}

export interface FinishTaskInput {
  task?: string;
  runId?: string;
  mode?: string;
  branch?: string;
  commit?: string;
  summary?: string;
  next?: string;
  tests?: string[];
  screenshots?: string[];
  risks?: string[];
  notify?: boolean;
  now?: Date | string;
}

export interface FailTaskInput extends FinishTaskInput {
  reason?: string;
}

export interface TaskOperationResult {
  ok: true;
  event: TaskEventName;
  state: TaskState;
  notification?: NotificationAttempt;
}

export interface NotificationAttempt {
  ok: boolean;
  result?: unknown;
  error?: SerializedError;
}

export interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
}

interface PartialTaskState {
  runId?: string;
  task?: string;
  status?: TaskLifecycleStatus;
  mode?: string;
  branch?: string;
  commit?: string;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
  summary?: string;
  next?: string;
  tests?: string[];
  screenshots?: string[];
  risks?: string[];
}

export class TaskStatusStore {
  readonly root: string;
  readonly cwd: string;

  private readonly notifier?: TaskNotifierLike;

  constructor(options: TaskStatusOptions = {}) {
    this.cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
    this.root = resolveStateRoot(options.root ?? DEFAULT_STATE_DIR, this.cwd);
    this.notifier = options.notifier;
  }

  async start(input: StartTaskInput = {}): Promise<TaskOperationResult> {
    const now = toDate(input.now);
    const task = input.task ?? 'Agent task';
    const state: TaskState = {
      runId: input.runId ?? createRunId(now, task),
      task,
      status: input.status ?? 'Researching',
      mode: input.mode ?? 'PLAN_FIRST',
      branch: input.branch ?? gitValue(['branch', '--show-current'], this.cwd),
      commit: input.commit ?? gitValue(['rev-parse', '--short', 'HEAD'], this.cwd),
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      summary: input.summary ?? 'Task started.',
      next: input.next ?? 'Research the request, then produce a plan before editing.',
      tests: input.tests ?? [],
      screenshots: input.screenshots ?? [],
      risks: input.risks ?? [],
    };

    await this.writeState(state);
    await this.appendEvent(state, 'started', { summary: state.summary });
    const notification = await this.notifyIfRequested('started', state, input.notify ?? false);
    return { ok: true, event: 'started', state, notification };
  }

  async update(input: UpdateTaskInput = {}): Promise<TaskOperationResult> {
    const current = await this.readState();
    const now = toDate(input.now);
    const state: TaskState = {
      ...current,
      status: input.status ?? current.status,
      mode: input.mode ?? current.mode,
      updatedAt: now.toISOString(),
      summary: input.summary ?? current.summary,
      next: input.next ?? current.next,
      tests: input.tests ?? current.tests,
      screenshots: input.screenshots ?? current.screenshots,
      risks: input.risks ?? current.risks,
    };
    delete state.finishedAt;

    await this.writeState(state);
    await this.appendEvent(state, 'updated', {
      status: state.status,
      summary: state.summary,
      next: state.next,
    });
    const notification = await this.notifyIfRequested('updated', state, input.notify ?? false);
    return { ok: true, event: 'updated', state, notification };
  }

  async finish(input: FinishTaskInput = {}): Promise<TaskOperationResult> {
    return this.complete('finished', input);
  }

  async fail(input: FailTaskInput = {}): Promise<TaskOperationResult> {
    return this.complete('failed', input);
  }

  async status(): Promise<TaskState> {
    return this.readState();
  }

  renderMarkdown(state: TaskState): string {
    return renderMarkdown(state);
  }

  renderNotificationMessage(event: TaskEventName, state: TaskState): string {
    return renderNotificationMessage(event, state);
  }

  private async complete(
    event: 'finished' | 'failed',
    input: FinishTaskInput | FailTaskInput,
  ): Promise<TaskOperationResult> {
    const current = await this.readState({ allowMissing: true });
    const now = toDate(input.now);
    const isFailure = event === 'failed';
    const currentRunId = optionalText(current.runId);
    const summary =
      optionalText(input.summary) ??
      (isFailure && 'reason' in input ? optionalText(input.reason) : undefined) ??
      optionalText(current.summary) ??
      (isFailure ? 'Task stopped.' : 'Task finished.');

    const state: TaskState = {
      runId: optionalText(input.runId) ?? currentRunId ?? createRunId(now, input.task ?? event),
      task: optionalText(input.task) ?? optionalText(current.task) ?? 'Agent task',
      status: isFailure ? 'Needs Human' : 'Done',
      mode: optionalText(input.mode) ?? optionalText(current.mode) ?? 'OVERNIGHT',
      branch: optionalText(input.branch) ?? optionalText(current.branch) ?? gitValue(['branch', '--show-current'], this.cwd),
      commit: optionalText(input.commit) ?? optionalText(current.commit) ?? gitValue(['rev-parse', '--short', 'HEAD'], this.cwd),
      startedAt: currentRunId ? current.startedAt : now.toISOString(),
      updatedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      summary,
      next:
        optionalText(input.next) ??
        optionalText(current.next) ??
        (isFailure ? 'Human intervention required.' : 'Human review.'),
      tests: input.tests ?? current.tests ?? [],
      screenshots: input.screenshots ?? current.screenshots ?? [],
      risks: input.risks ?? current.risks ?? [],
    };

    await this.writeState(state);
    await this.appendEvent(state, event, {
      summary: state.summary,
      next: state.next,
    });
    const notification = await this.notifyIfRequested(event, state, input.notify ?? true);
    return { ok: true, event, state, notification };
  }

  private async readState({ allowMissing = false } = {}): Promise<TaskState> {
    try {
      const text = await fs.readFile(this.currentJsonPath(), 'utf8');
      return normalizeState(JSON.parse(text) as PartialTaskState);
    } catch (error) {
      if (allowMissing && isNodeError(error) && error.code === 'ENOENT') {
        return normalizeState({});
      }
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new Error(`No current task status found at ${this.currentJsonPath()}. Run start first.`);
      }
      throw error;
    }
  }

  private async writeState(state: TaskState): Promise<void> {
    const runDir = this.runDir(state.runId);
    await fs.mkdir(runDir, { recursive: true });

    const json = `${JSON.stringify(state, null, 2)}\n`;
    const markdown = renderMarkdown(state);

    await writeFileAtomic(this.currentJsonPath(), json, { backup: true });
    await writeFileAtomic(this.currentMarkdownPath(), markdown, { backup: true });
    await writeFileAtomic(path.join(runDir, 'status.json'), json, { backup: false });
    await writeFileAtomic(path.join(runDir, 'status.md'), markdown, { backup: false });
  }

  private async appendEvent(state: TaskState, event: TaskEventName, payload: unknown): Promise<TaskEvent> {
    const entry: TaskEvent = {
      at: new Date().toISOString(),
      event,
      runId: state.runId,
      status: state.status,
      payload: sanitizeForEvent(payload),
    };
    await fs.mkdir(this.runDir(state.runId), { recursive: true });
    await fs.appendFile(path.join(this.runDir(state.runId), 'events.jsonl'), `${JSON.stringify(entry)}\n`);
    return entry;
  }

  private async notifyIfRequested(
    event: TaskEventName,
    state: TaskState,
    shouldNotify: boolean,
  ): Promise<NotificationAttempt | undefined> {
    if (!shouldNotify || !this.notifier) return undefined;

    try {
      const result = await callNotifier(this.notifier, {
        event,
        state,
        text: renderNotificationMessage(event, state),
      });
      const attempt: NotificationAttempt = { ok: true, result: sanitizeForEvent(result) };
      await this.appendEvent(state, 'notified', { event, result });
      return attempt;
    } catch (error) {
      const serialized = serializeError(error);
      const attempt: NotificationAttempt = { ok: false, error: serialized };
      await this.appendEvent(state, 'notification_failed', { event, error: serialized });
      return attempt;
    }
  }

  private currentJsonPath(): string {
    return path.join(this.root, 'current-task.json');
  }

  private currentMarkdownPath(): string {
    return path.join(this.root, 'current-task.md');
  }

  private runDir(runId: string): string {
    return path.join(this.root, 'runs', runId);
  }
}

export function createTaskStatus(options: TaskStatusOptions = {}): TaskStatusStore {
  return new TaskStatusStore(options);
}

export async function start(input: StartTaskInput = {}, options: TaskStatusOptions = {}): Promise<TaskOperationResult> {
  return createTaskStatus(options).start(input);
}

export async function update(input: UpdateTaskInput = {}, options: TaskStatusOptions = {}): Promise<TaskOperationResult> {
  return createTaskStatus(options).update(input);
}

export async function finish(input: FinishTaskInput = {}, options: TaskStatusOptions = {}): Promise<TaskOperationResult> {
  return createTaskStatus(options).finish(input);
}

export async function fail(input: FailTaskInput = {}, options: TaskStatusOptions = {}): Promise<TaskOperationResult> {
  return createTaskStatus(options).fail(input);
}

export async function status(options: TaskStatusOptions = {}): Promise<TaskState> {
  return createTaskStatus(options).status();
}

export function renderMarkdown(state: TaskState): string {
  const lines = [
    '# Current Agent Task',
    '',
    `- Task: ${state.task || ''}`,
    `- Status: ${state.status || ''}`,
    `- Mode: ${state.mode || ''}`,
    `- Run ID: ${state.runId || ''}`,
    `- Branch: ${state.branch || ''}`,
    `- Commit: ${state.commit || ''}`,
    `- Started: ${state.startedAt || ''}`,
    `- Updated: ${state.updatedAt || ''}`,
  ];

  if (state.finishedAt) lines.push(`- Finished: ${state.finishedAt}`);
  lines.push('', '## Summary', '', state.summary || '');
  lines.push('', '## Next', '', state.next || '');
  appendMarkdownList(lines, 'Tests', state.tests);
  appendMarkdownList(lines, 'Screenshots', state.screenshots);
  appendMarkdownList(lines, 'Risks', state.risks);
  return `${lines.join('\n')}\n`;
}

export function renderNotificationMessage(event: TaskEventName, state: TaskState): string {
  const title =
    event === 'finished'
      ? 'Agent task finished'
      : event === 'failed'
        ? 'Agent task stopped'
        : event === 'started'
          ? 'Agent task started'
          : 'Agent task status';

  const lines = [
    title,
    '',
    `Task: ${state.task || 'Agent task'}`,
    `Status: ${state.status || ''}`,
    state.mode ? `Mode: ${state.mode}` : null,
    state.branch ? `Branch: ${state.branch}` : null,
    state.runId ? `Run: ${state.runId}` : null,
    '',
    state.summary ? `Summary: ${state.summary}` : null,
    state.next ? `Next: ${state.next}` : null,
  ].filter((line): line is string => line !== null);

  appendPlainList(lines, 'Tests', state.tests);
  appendPlainList(lines, 'Screenshots', state.screenshots);
  appendPlainList(lines, 'Risks', state.risks);
  return lines.join('\n');
}

function normalizeState(state: PartialTaskState): TaskState {
  const now = new Date(0).toISOString();
  return {
    runId: state.runId ?? '',
    task: state.task ?? '',
    status: state.status ?? 'Researching',
    mode: state.mode ?? '',
    branch: state.branch ?? '',
    commit: state.commit ?? '',
    startedAt: state.startedAt ?? now,
    updatedAt: state.updatedAt ?? now,
    finishedAt: state.finishedAt,
    summary: state.summary ?? '',
    next: state.next ?? '',
    tests: state.tests ?? [],
    screenshots: state.screenshots ?? [],
    risks: state.risks ?? [],
  };
}

function appendMarkdownList(lines: string[], title: string, items: string[] = []): void {
  lines.push('', `## ${title}`, '');
  if (!items.length) {
    lines.push('- None recorded.');
    return;
  }
  for (const item of items) lines.push(`- ${item}`);
}

function appendPlainList(lines: string[], title: string, items: string[] = []): void {
  if (!items.length) return;
  lines.push('', `${title}:`);
  for (const item of items.slice(0, 8)) lines.push(`- ${item}`);
}

async function callNotifier(notifier: TaskNotifierLike, notification: TaskNotification): Promise<unknown> {
  if (typeof notifier === 'function') return notifier(notification);
  return notifier.notify(notification);
}

function resolveStateRoot(root: string, cwd: string): string {
  return path.isAbsolute(root) ? root : path.resolve(cwd, root);
}

function toDate(value?: Date | string): Date {
  if (!value) return new Date();
  return value instanceof Date ? value : new Date(value);
}

function optionalText(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function createRunId(date: Date, task: string): string {
  return `${formatDateForId(date)}-${slugify(task)}-${crypto.randomBytes(2).toString('hex')}`;
}

function formatDateForId(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-');
}

function slugify(value: string): string {
  return (
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'task'
  );
}

function gitValue(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

async function writeFileAtomic(filePath: string, content: string, { backup }: { backup: boolean }): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (backup) {
    try {
      await fs.copyFile(filePath, `${filePath}.bak`);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
    }
  }

  const tmp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let handle: fs.FileHandle | undefined;
  try {
    await fs.writeFile(tmp, content);
    try {
      handle = await fs.open(tmp, 'r+');
      await handle.sync();
    } finally {
      await handle?.close();
    }
    await fs.rename(tmp, filePath);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function sanitizeForEvent(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return null;
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => sanitizeForEvent(item, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitiveKey(key) ? '[REDACTED]' : sanitizeForEvent(item, seen);
    }
    seen.delete(value);
    return output;
  }
  return String(value);
}

function redactString(value: string): string {
  let output = value;
  for (const secret of collectSensitiveEnvValues()) {
    output = output.split(secret).join('[REDACTED]');
  }
  return output;
}

function collectSensitiveEnvValues(): string[] {
  const values = new Set<string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || value.length < 4) continue;
    if (isSensitiveKey(key) || value.length >= 32) values.add(value);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

function isSensitiveKey(key: string): boolean {
  return /token|secret|password|passwd|pwd|api[_-]?key|auth|cookie|credential|private/i.test(key);
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}
