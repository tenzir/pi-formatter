import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExecResult, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  FormatRunContext,
  type FormatWarningReporter,
  findConfigFileFromPath,
} from "./context.js";
import { detectFileKind, getRelativePathOrAbsolute } from "./path.js";
import { FORMAT_PLAN } from "./plan.js";
import { RUNNERS } from "./runners/index.js";
import { hasCommand } from "./system.js";
import {
  isDynamicRunner,
  type ResolvedLauncher,
  type RunnerContext,
  type RunnerDefinition,
  type RunnerGroup,
  type RunnerLauncher,
} from "./types.js";

const TREEFMT_CONFIG_PATTERNS = ["treefmt.toml", ".treefmt.toml"] as const;
const TREEFMT_NIX_CONFIG_PATTERNS = ["treefmt.nix", "nix/treefmt.nix"] as const;
const FLAKE_CONFIG_PATTERNS = ["flake.nix"] as const;

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
        `${runner.id} skipped: invalid version requirement in ${requirement.patterns.join(", ")}`,
      );
    }

    return false;
  }

  const versionCommand =
    requirement.command ?? defaultVersionCommand(runner.launcher);
  const installedVersion =
    await ctx.getInstalledToolMajorVersion(versionCommand);

  if (installedVersion === requiredVersion) {
    return true;
  }

  const onMismatch = requirement.onMismatch ?? "warn-skip";
  if (onMismatch === "warn-skip") {
    ctx.warn(
      `${runner.id} skipped: ${versionCommand} version mismatch (have ${installedVersion ?? "unknown"}, need ${requiredVersion})`,
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

export interface FormatCallSummary {
  runnerId: string;
  status: "succeeded" | "failed";
  exitCode?: number;
  failureMessage?: string;
}

export type FormatCallSummaryReporter = (summary: FormatCallSummary) => void;

const MAX_FAILURE_MESSAGE_LENGTH = 140;
const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_COLOR_SEQUENCE_PATTERN = new RegExp(
  `${ANSI_ESCAPE}\\[[0-9;]*m`,
  "g",
);

function normalizeFailureLine(line: string): string {
  return line
    .replace(ANSI_COLOR_SEQUENCE_PATTERN, "")
    .replace(/^\s*\[error\]\s*/i, "")
    .replace(/^\s*error:\s*/i, "")
    .replace(/^\s*[×✖✘]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeFailureMessage(result: ExecResult): string | undefined {
  const lines = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((line) => normalizeFailureLine(line))
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return undefined;
  }

  const withMarker = lines.find((line) =>
    /\b(error|failed|invalid|unexpected|expected|syntax)\b/i.test(line),
  );
  const message = withMarker ?? lines[0];

  return message.length <= MAX_FAILURE_MESSAGE_LENGTH
    ? message
    : `${message.slice(0, MAX_FAILURE_MESSAGE_LENGTH - 1)}…`;
}

function isTreefmtUnmatchedPathFailure(result: ExecResult): boolean {
  return /\bno formatter for path:/i.test(`${result.stderr}\n${result.stdout}`);
}

function shouldFallbackFromTreefmtNixFailure(result: ExecResult): boolean {
  const output = `${result.stderr}\n${result.stdout}`;
  return (
    /cannot connect to socket at '.*daemon-socket\/socket'/i.test(output) ||
    /Refusing to evaluate package .* because it is not available on the requested hostPlatform/i.test(
      output,
    ) ||
    /failed to create walker: error resolving path/i.test(output) ||
    /\bpath .* not inside the tree root\b/i.test(output)
  );
}

async function flakeUsesTreefmtNix(flakePath: string): Promise<boolean> {
  try {
    const content = await readFile(flakePath, "utf8");
    return /\btreefmt-nix\b/.test(content);
  } catch {
    return false;
  }
}

async function shouldTryTreefmtNix(
  filePath: string,
  flakePath: string,
): Promise<boolean> {
  const flakeRoot = dirname(flakePath);

  if (
    (await findConfigFileFromPath(
      filePath,
      TREEFMT_NIX_CONFIG_PATTERNS,
      flakeRoot,
    )) !== undefined
  ) {
    return true;
  }

  return flakeUsesTreefmtNix(flakePath);
}

function reportProjectFormatterFailure(
  runnerId: string,
  result: ExecResult,
  summaryReporter?: FormatCallSummaryReporter,
  warningReporter?: FormatWarningReporter,
): void {
  const failureMessage = summarizeFailureMessage(result);
  summaryReporter?.({
    runnerId,
    status: "failed",
    exitCode: result.code,
    failureMessage,
  });

  const warningMessage = `${runnerId} failed (${result.code})${
    failureMessage ? `: ${failureMessage}` : ""
  }`;
  if (warningReporter) {
    warningReporter(warningMessage);
  } else {
    console.warn(warningMessage);
  }
}

function reportProjectFormatterFallback(
  runnerId: string,
  result: ExecResult,
  warningReporter?: FormatWarningReporter,
): void {
  const failureMessage = summarizeFailureMessage(result);
  const warningMessage = `${runnerId} unavailable, falling back to built-in formatters${
    failureMessage ? `: ${failureMessage}` : ""
  }`;

  if (warningReporter) {
    warningReporter(warningMessage);
    return;
  }

  console.warn(warningMessage);
}

async function tryTreefmt(
  pi: ExtensionAPI,
  cwd: string,
  filePath: string,
  timeoutMs: number,
  summaryReporter?: FormatCallSummaryReporter,
  warningReporter?: FormatWarningReporter,
): Promise<RunnerOutcome> {
  const configPath = await findConfigFileFromPath(
    filePath,
    TREEFMT_CONFIG_PATTERNS,
    cwd,
  );

  if (!configPath) {
    return "skipped";
  }

  if (!(await hasCommand("treefmt"))) {
    return "skipped";
  }

  const targetPath = getRelativePathOrAbsolute(filePath, cwd);
  const result = await pi.exec(
    "treefmt",
    [
      "--quiet",
      "--no-cache",
      "--on-unmatched",
      "fatal",
      "--config-file",
      configPath,
      targetPath,
    ],
    {
      cwd,
      timeout: timeoutMs,
    },
  );

  if (result.code === 0) {
    summaryReporter?.({
      runnerId: "treefmt",
      status: "succeeded",
    });
    return "succeeded";
  }

  // Treefmt currently reports excluded files as "no formatter for path" too, so
  // we cannot distinguish an explicit exclude from a genuinely unmatched path
  // here. In both cases, fall back to the built-in per-language runners.
  if (isTreefmtUnmatchedPathFailure(result)) {
    return "skipped";
  }

  reportProjectFormatterFailure(
    "treefmt",
    result,
    summaryReporter,
    warningReporter,
  );

  return "failed";
}

async function tryTreefmtNix(
  pi: ExtensionAPI,
  cwd: string,
  filePath: string,
  timeoutMs: number,
  summaryReporter?: FormatCallSummaryReporter,
  warningReporter?: FormatWarningReporter,
): Promise<RunnerOutcome> {
  const flakePath = await findConfigFileFromPath(
    filePath,
    FLAKE_CONFIG_PATTERNS,
    cwd,
  );

  if (!flakePath) {
    return "skipped";
  }

  if (!(await shouldTryTreefmtNix(filePath, flakePath))) {
    return "skipped";
  }

  if (!(await hasCommand("nix"))) {
    return "skipped";
  }

  const flakeRoot = dirname(flakePath);
  const targetPath = getRelativePathOrAbsolute(filePath, flakeRoot);
  const result = await pi.exec(
    "nix",
    [
      "--extra-experimental-features",
      "nix-command flakes",
      "fmt",
      "--no-update-lock-file",
      "--no-write-lock-file",
      "--",
      targetPath,
    ],
    {
      cwd: flakeRoot,
      timeout: timeoutMs,
    },
  );

  if (result.code === 0) {
    summaryReporter?.({
      runnerId: "treefmt-nix",
      status: "succeeded",
    });
    return "succeeded";
  }

  if (isTreefmtUnmatchedPathFailure(result)) {
    return "skipped";
  }

  if (shouldFallbackFromTreefmtNixFailure(result)) {
    reportProjectFormatterFallback("treefmt-nix", result, warningReporter);
    return "skipped";
  }

  reportProjectFormatterFailure(
    "treefmt-nix",
    result,
    summaryReporter,
    warningReporter,
  );

  return "failed";
}

async function runRunner(
  ctx: RunnerContext,
  runner: RunnerDefinition,
  summaryReporter?: FormatCallSummaryReporter,
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

  const commandArgs = [...launcher.argsPrefix, ...args];

  const result = await ctx.exec(launcher.command, commandArgs);

  if (result.code !== 0) {
    const failureMessage = summarizeFailureMessage(result);

    summaryReporter?.({
      runnerId: runner.id,
      status: "failed",
      exitCode: result.code,
      failureMessage,
    });

    ctx.warn(
      `${runner.id} failed (${result.code})${failureMessage ? `: ${failureMessage}` : ""}`,
    );
    return "failed";
  }

  summaryReporter?.({
    runnerId: runner.id,
    status: "succeeded",
  });

  return "succeeded";
}

async function runRunnerGroup(
  ctx: RunnerContext,
  group: RunnerGroup,
  summaryReporter?: FormatCallSummaryReporter,
): Promise<void> {
  if (group.mode === "all") {
    for (const runnerId of group.runnerIds) {
      const runner = RUNNERS.get(runnerId);
      if (!runner) {
        ctx.warn(`unknown runner in format plan: ${runnerId}`);
        continue;
      }

      await runRunner(ctx, runner, summaryReporter);
    }

    return;
  }

  const fallbackSummaries: FormatCallSummary[] = [];
  const fallbackSummaryReporter = summaryReporter
    ? (summary: FormatCallSummary) => {
        fallbackSummaries.push(summary);
      }
    : undefined;

  for (const runnerId of group.runnerIds) {
    const runner = RUNNERS.get(runnerId);
    if (!runner) {
      ctx.warn(`unknown runner in format plan: ${runnerId}`);
      continue;
    }

    const outcome = await runRunner(ctx, runner, fallbackSummaryReporter);
    if (outcome === "succeeded") {
      if (!summaryReporter) {
        return;
      }

      const successSummary = [...fallbackSummaries]
        .reverse()
        .find((summary) => summary.status === "succeeded");
      if (successSummary) {
        summaryReporter(successSummary);
      }

      return;
    }
  }

  if (!summaryReporter) {
    return;
  }

  const lastFailureSummary = [...fallbackSummaries]
    .reverse()
    .find((summary) => summary.status === "failed");

  if (lastFailureSummary) {
    summaryReporter(lastFailureSummary);
  }
}

export async function formatFile(
  pi: ExtensionAPI,
  cwd: string,
  filePath: string,
  timeoutMs: number,
  summaryReporter?: FormatCallSummaryReporter,
  warningReporter?: FormatWarningReporter,
): Promise<void> {
  if (
    (await tryTreefmt(
      pi,
      cwd,
      filePath,
      timeoutMs,
      summaryReporter,
      warningReporter,
    )) !== "skipped"
  ) {
    return;
  }

  if (
    (await tryTreefmtNix(
      pi,
      cwd,
      filePath,
      timeoutMs,
      summaryReporter,
      warningReporter,
    )) !== "skipped"
  ) {
    return;
  }

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
    kind,
    timeoutMs,
    warningReporter,
  );

  for (const group of groups) {
    await runRunnerGroup(runContext, group, summaryReporter);
  }
}
