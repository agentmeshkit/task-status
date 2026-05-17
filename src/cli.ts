#!/usr/bin/env node
import { createTaskStatus, renderMarkdown, type TaskLifecycleStatus } from './index.js';

type Command = 'start' | 'update' | 'finish' | 'fail' | 'status' | 'help';

interface CliOptions {
  root: string;
  task?: string;
  status?: TaskLifecycleStatus;
  mode?: string;
  branch?: string;
  commit?: string;
  runId?: string;
  summary?: string;
  reason?: string;
  next?: string;
  tests?: string[];
  screenshots?: string[];
  risks?: string[];
  notify?: boolean;
  json?: boolean;
  help?: boolean;
}

await main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

async function main(argv: string[]): Promise<void> {
  const [command, rawArgs] = splitCommand(stripPnpmSeparator(argv));
  const options = parseArgs(rawArgs);

  if (command === 'help' || options.help) {
    printHelp();
    return;
  }

  const taskStatus = createTaskStatus({ root: options.root });

  if (command === 'start') {
    const result = await taskStatus.start({
      task: options.task,
      runId: options.runId,
      status: options.status,
      mode: options.mode,
      branch: options.branch,
      commit: options.commit,
      summary: options.summary,
      next: options.next,
      tests: options.tests,
      screenshots: options.screenshots,
      risks: options.risks,
      notify: options.notify,
    });
    printJson(commandResult(command, result.state, options.root));
    return;
  }

  if (command === 'update') {
    const result = await taskStatus.update({
      status: options.status,
      mode: options.mode,
      summary: options.summary,
      next: options.next,
      tests: options.tests,
      screenshots: options.screenshots,
      risks: options.risks,
      notify: options.notify,
    });
    printJson(commandResult(command, result.state, options.root));
    return;
  }

  if (command === 'finish') {
    const result = await taskStatus.finish({
      task: options.task,
      runId: options.runId,
      mode: options.mode,
      branch: options.branch,
      commit: options.commit,
      summary: options.summary,
      next: options.next,
      tests: options.tests,
      screenshots: options.screenshots,
      risks: options.risks,
      notify: options.notify,
    });
    printJson(commandResult(command, result.state, options.root));
    return;
  }

  if (command === 'fail') {
    const result = await taskStatus.fail({
      task: options.task,
      runId: options.runId,
      mode: options.mode,
      branch: options.branch,
      commit: options.commit,
      summary: options.summary,
      reason: options.reason,
      next: options.next,
      tests: options.tests,
      screenshots: options.screenshots,
      risks: options.risks,
      notify: options.notify,
    });
    printJson(commandResult(command, result.state, options.root));
    return;
  }

  if (command === 'status') {
    const state = await taskStatus.status();
    if (options.json) printJson(state);
    else process.stdout.write(renderMarkdown(state));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function splitCommand(argv: string[]): [Command, string[]] {
  if (argv.length === 0) return ['help', []];
  const [command, ...args] = argv;
  if (isCommand(command)) return [command, args];
  throw new Error(`Unknown command: ${command}`);
}

function isCommand(command: string): command is Command {
  return ['start', 'update', 'finish', 'fail', 'status', 'help'].includes(command);
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {
    root: '.codex-team',
    tests: undefined,
    screenshots: undefined,
    risks: undefined,
    notify: undefined,
    json: false,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--notify') parsed.notify = true;
    else if (arg === '--no-notify') parsed.notify = false;
    else if (arg === '--root') parsed.root = takeValue(args, ++i, arg);
    else if (arg === '--task') parsed.task = takeValue(args, ++i, arg);
    else if (arg === '--status') parsed.status = takeValue(args, ++i, arg);
    else if (arg === '--mode') parsed.mode = takeValue(args, ++i, arg);
    else if (arg === '--branch') parsed.branch = takeValue(args, ++i, arg);
    else if (arg === '--commit') parsed.commit = takeValue(args, ++i, arg);
    else if (arg === '--run-id') parsed.runId = takeValue(args, ++i, arg);
    else if (arg === '--summary') parsed.summary = takeValue(args, ++i, arg);
    else if (arg === '--reason') parsed.reason = takeValue(args, ++i, arg);
    else if (arg === '--next') parsed.next = takeValue(args, ++i, arg);
    else if (arg === '--test' || arg === '--tests') parsed.tests = [...(parsed.tests ?? []), takeValue(args, ++i, arg)];
    else if (arg === '--screenshot') parsed.screenshots = [...(parsed.screenshots ?? []), takeValue(args, ++i, arg)];
    else if (arg === '--risk') parsed.risks = [...(parsed.risks ?? []), takeValue(args, ++i, arg)];
    else throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

function stripPnpmSeparator(args: string[]): string[] {
  return args[0] === '--' ? args.slice(1) : args;
}

function takeValue(args: string[], index: number, flag: string): string {
  if (index >= args.length || args[index]?.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return args[index]!;
}

function commandResult(command: string, state: { runId: string; status: string }, root: string): unknown {
  return {
    ok: true,
    command,
    runId: state.runId,
    status: state.status,
    current: `${root.replace(/\/$/, '')}/current-task.md`,
  };
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp(): void {
  console.log(`Usage:
  agentmeshkit-task-status start --task "Task name" --mode PLAN_FIRST
  agentmeshkit-task-status update --status Testing --summary "What is happening"
  agentmeshkit-task-status finish --summary "Done" --test "pnpm build: PASS"
  agentmeshkit-task-status fail --reason "Blocked by missing requirement"
  agentmeshkit-task-status status [--json]

Commands:
  start      Create current-task.* and a run directory.
  update     Update current task status and append an event.
  finish     Mark task Done and append completion details.
  fail       Mark task Needs Human and append failure details.
  status     Print the current task status.

Options:
  --root <path>             State directory. Default: .codex-team.
  --task <text>
  --mode <text>             Example: PLAN_FIRST or OVERNIGHT.
  --status <text>
  --summary <text>
  --reason <text>           fail only; used as summary when --summary is absent.
  --next <text>
  --run-id <id>
  --branch <name>
  --commit <sha>
  --test <text>             Repeatable.
  --screenshot <path>       Repeatable.
  --risk <text>             Repeatable.
  --notify                  Notify through a library-provided notifier, if one is configured.
  --no-notify               Disable finish/fail notification attempts.
`);
}
