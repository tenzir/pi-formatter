import type { ExtensionAPI, ExecResult } from "@mariozechner/pi-coding-agent";
import { FormatRunContext } from "./context.js";
import { detectFileKind } from "./path.js";
import { FORMAT_PLAN } from "./plan.js";
import { RUNNERS } from "./runners/index.js";
import {
  isDynamicRunner,
  type ResolvedLauncher,
  type RunnerDefinition,
  type RunnerGroup,
  type RunnerLauncher,
  type RunnerContext,
  type SourceTool,
} from "./types.js";

function summarizeExecResult(result: ExecResult): string {
  const output = `${result.stderr}\n${result.stdout}`.trim();
  if (!output) {
    return "";
  }

  const firstLine = output.split(/\r?\n/, 1)[0];
  return `: ${firstLine}`;
}

async function resolveLauncher(
  launcher: RunnerLauncher,
  ctx: RunnerContext,
): Promise<ResolvedLauncher | undefined> {
  if (launcher.type === "direct") {
    if (await ctx.hasCommand(launcher.command)) {
      return { command: launcher.command, argsPrefix: [] };
    }

    return undefined;
  }

  if (launcher.type === "pypi") {
    if (await ctx.hasCommand(launcher.tool)) {
      return { command: launcher.tool, argsPrefix: [] };
    }

    if (await ctx.hasCommand("uv")) {
      return {
        command: "uv",
        argsPrefix: ["tool", "run", launcher.tool],
      };
    }

    return undefined;
  }

  if (await ctx.hasCommand(launcher.tool)) {
    return { command: launcher.tool, argsPrefix: [] };
  }

  if (await ctx.hasCommand("go")) {
    return {
      command: "go",
      argsPrefix: ["run", launcher.module],
    };
  }

  return undefined;
}

function defaultVersionCommand(launcher: RunnerLauncher): string {
  if (launcher.type === "direct") {
    return launcher.command;
  }

  return launcher.tool;
}

async function satisfiesRunnerRequirements(
  ctx: RunnerContext,
  runner: RunnerDefinition,
): Promise<boolean> {
  const requirement = runner.requires?.majorVersionFromConfig;
  if (!requirement) {
    return true;
  }

  const requiredVersion = await ctx.getRequiredMajorVersionFromConfig(
    requirement.patterns,
  );

  if (requiredVersion === undefined) {
    return true;
  }

  if (requiredVersion === "invalid") {
    const onInvalid = requirement.onInvalid ?? "warn-skip";
    if (onInvalid === "warn-skip") {
      ctx.warn(
        `[pi-formatter] ${runner.id} skipped: invalid version requirement in ${requirement.patterns.join(", ")}`,
      );
    }

    return false;
  }

  const versionCommand = requirement.command ?? defaultVersionCommand(runner.launcher);
  const installedVersion = await ctx.getInstalledToolMajorVersion(versionCommand);

  if (installedVersion === requiredVersion) {
    return true;
  }

  const onMismatch = requirement.onMismatch ?? "warn-skip";
  if (onMismatch === "warn-skip") {
    ctx.warn(
      `[pi-formatter] ${runner.id} skipped: ${versionCommand} version mismatch (have ${installedVersion ?? "unknown"}, need ${requiredVersion})`,
    );
  }

  return false;
}

async function resolveRunnerArgs(
  ctx: RunnerContext,
  runner: RunnerDefinition,
): Promise<string[] | undefined> {
  if (isDynamicRunner(runner)) {
    return runner.buildArgs(ctx);
  }

  const args = [...runner.args];
  if (runner.appendFile !== false) {
    args.push(ctx.filePath);
  }

  return args;
}

type RunnerOutcome = "skipped" | "failed" | "succeeded";

async function runRunner(
  ctx: RunnerContext,
  runner: RunnerDefinition,
): Promise<RunnerOutcome> {
  const launcher = await resolveLauncher(runner.launcher, ctx);
  if (!launcher) {
    return "skipped";
  }

  if (runner.when && !(await runner.when(ctx))) {
    return "skipped";
  }

  if (!(await satisfiesRunnerRequirements(ctx, runner))) {
    return "skipped";
  }

  const args = await resolveRunnerArgs(ctx, runner);
  if (!args) {
    return "skipped";
  }

  const result = await ctx.exec(launcher.command, [...launcher.argsPrefix, ...args]);
  if (!result) {
    ctx.warn(`[pi-formatter] ${runner.id} failed to execute`);
    return "failed";
  }

  if (result.code !== 0) {
    ctx.warn(
      `[pi-formatter] ${runner.id} exited with code ${result.code}${summarizeExecResult(result)}`,
    );
    return "failed";
  }

  return "succeeded";
}

async function runRunnerGroup(
  ctx: RunnerContext,
  group: RunnerGroup,
): Promise<void> {
  if (group.mode === "all") {
    for (const runnerId of group.runnerIds) {
      const runner = RUNNERS.get(runnerId);
      if (!runner) {
        ctx.warn(`[pi-formatter] unknown runner in format plan: ${runnerId}`);
        continue;
      }

      await runRunner(ctx, runner);
    }

    return;
  }

  for (const runnerId of group.runnerIds) {
    const runner = RUNNERS.get(runnerId);
    if (!runner) {
      ctx.warn(`[pi-formatter] unknown runner in format plan: ${runnerId}`);
      continue;
    }

    const outcome = await runRunner(ctx, runner);
    if (outcome === "succeeded") {
      break;
    }
  }
}

export async function formatFile(
  pi: ExtensionAPI,
  cwd: string,
  sourceTool: SourceTool,
  filePath: string,
  timeoutMs: number,
): Promise<void> {
  const kind = detectFileKind(filePath);
  if (!kind) {
    return;
  }

  const groups = FORMAT_PLAN[kind];
  if (!groups || groups.length === 0) {
    return;
  }

  const runContext = new FormatRunContext(
    pi,
    cwd,
    filePath,
    sourceTool,
    kind,
    timeoutMs,
  );

  for (const group of groups) {
    await runRunnerGroup(runContext, group);
  }
}
