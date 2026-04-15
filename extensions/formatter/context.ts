import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  getRelativePathOrAbsolute,
  isWithinDirectory,
  pathExists,
} from "./path.js";
import { hasCommand } from "./system.js";
import type { FileKind, RequiredMajorVersion, RunnerContext } from "./types.js";

const globRegexCache = new Map<string, RegExp>();

function getPatternRegex(pattern: string): RegExp {
  const cached = globRegexCache.get(pattern);
  if (cached) {
    return cached;
  }

  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&"))
    .join(".*");

  const regex = new RegExp(`^${escaped}$`);
  globRegexCache.set(pattern, regex);
  return regex;
}

export async function findConfigFileFromPath(
  filePath: string,
  patterns: readonly string[],
  rootDirectory: string,
): Promise<string | undefined> {
  const root = resolve(rootDirectory);
  let dir = resolve(dirname(filePath));

  if (!isWithinDirectory(dir, root)) {
    return undefined;
  }

  while (isWithinDirectory(dir, root)) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      entries = [];
    }

    for (const pattern of patterns) {
      const regex = getPatternRegex(pattern);
      const matchingEntry = entries.find((entry) => regex.test(entry));
      if (matchingEntry) {
        return join(dir, matchingEntry);
      }
    }

    if (dir === root) {
      break;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }

    dir = parent;
  }

  return undefined;
}

function getLineRangesFromDiff(diffOutput: string): string[] {
  const ranges: string[] = [];

  for (const line of diffOutput.split(/\r?\n/)) {
    const match = line.match(/^@@ .* \+([0-9]+)(?:,([0-9]+))? @@/);
    if (!match) {
      continue;
    }

    const start = Number.parseInt(match[1], 10);
    const count = match[2] ? Number.parseInt(match[2], 10) : 1;

    if (!Number.isFinite(start) || !Number.isFinite(count) || count <= 0) {
      continue;
    }

    ranges.push(`${start}:${start + count - 1}`);
  }

  return ranges;
}

function compareLineRanges(a: string, b: string): number {
  const [aStart] = a.split(":", 1);
  const [bStart] = b.split(":", 1);
  return Number.parseInt(aStart, 10) - Number.parseInt(bStart, 10);
}

export type FormatWarningReporter = (message: string) => void;

export class FormatRunContext implements RunnerContext {
  readonly filePath: string;
  readonly cwd: string;
  readonly kind: FileKind;

  private readonly pi: ExtensionAPI;
  private readonly timeoutMs: number;
  private readonly warningReporter?: FormatWarningReporter;

  private readonly configLookupCache = new Map<
    string,
    Promise<string | undefined>
  >();
  private readonly requiredMajorVersionCache = new Map<
    string,
    Promise<RequiredMajorVersion>
  >();
  private readonly installedMajorVersionCache = new Map<
    string,
    Promise<string | undefined>
  >();

  private changedLinesPromise?: Promise<string[]>;
  private editorConfigInCwdPromise?: Promise<boolean>;

  constructor(
    pi: ExtensionAPI,
    cwd: string,
    filePath: string,
    kind: FileKind,
    timeoutMs: number,
    warningReporter?: FormatWarningReporter,
  ) {
    this.pi = pi;
    this.cwd = cwd;
    this.filePath = filePath;
    this.kind = kind;
    this.timeoutMs = timeoutMs;
    this.warningReporter = warningReporter;
  }

  async hasCommand(command: string): Promise<boolean> {
    return hasCommand(command);
  }

  async findConfigFile(
    patterns: readonly string[],
  ): Promise<string | undefined> {
    const key = patterns.join("\u0000");
    let cached = this.configLookupCache.get(key);

    if (!cached) {
      cached = findConfigFileFromPath(this.filePath, patterns, this.cwd);
      this.configLookupCache.set(key, cached);
    }

    return cached;
  }

  async hasConfig(patterns: readonly string[]): Promise<boolean> {
    return (await this.findConfigFile(patterns)) !== undefined;
  }

  async hasEditorConfigInCwd(): Promise<boolean> {
    if (!this.editorConfigInCwdPromise) {
      this.editorConfigInCwdPromise = this.resolveEditorConfigInCwd();
    }

    return this.editorConfigInCwdPromise;
  }

  async exec(command: string, args: string[]) {
    return this.pi.exec(command, args, {
      cwd: this.cwd,
      timeout: this.timeoutMs,
    });
  }

  async getChangedLines(): Promise<string[]> {
    if (!this.changedLinesPromise) {
      this.changedLinesPromise = this.resolveChangedLines();
    }

    return this.changedLinesPromise;
  }

  async getRequiredMajorVersionFromConfig(
    patterns: readonly string[],
  ): Promise<RequiredMajorVersion> {
    const key = patterns.join("\u0000");
    let cached = this.requiredMajorVersionCache.get(key);

    if (!cached) {
      cached = this.resolveRequiredMajorVersionFromConfig(patterns);
      this.requiredMajorVersionCache.set(key, cached);
    }

    return cached;
  }

  async getInstalledToolMajorVersion(
    command: string,
  ): Promise<string | undefined> {
    let cached = this.installedMajorVersionCache.get(command);

    if (!cached) {
      cached = this.resolveInstalledToolMajorVersion(command);
      this.installedMajorVersionCache.set(command, cached);
    }

    return cached;
  }

  warn(message: string): void {
    if (this.warningReporter) {
      this.warningReporter(message);
      return;
    }

    console.warn(message);
  }

  private async resolveEditorConfigInCwd(): Promise<boolean> {
    const root = resolve(this.cwd);
    let dir = dirname(this.filePath);

    while (isWithinDirectory(dir, root)) {
      if (await pathExists(join(dir, ".editorconfig"))) {
        return true;
      }

      const parent = dirname(dir);
      if (parent === dir) {
        break;
      }

      dir = parent;
    }

    return false;
  }

  private async resolveChangedLines(): Promise<string[]> {
    const diffPath = getRelativePathOrAbsolute(this.filePath, this.cwd);
    const rangeSet = new Set<string>();

    const diffArgSets = [
      ["diff", "--unified=0", "--", diffPath],
      ["diff", "--cached", "--unified=0", "--", diffPath],
    ];

    for (const args of diffArgSets) {
      const diffResult = await this.exec("git", args);
      if (diffResult.code !== 0) {
        continue;
      }

      for (const range of getLineRangesFromDiff(diffResult.stdout)) {
        rangeSet.add(range);
      }
    }

    return [...rangeSet].sort(compareLineRanges);
  }

  private async resolveRequiredMajorVersionFromConfig(
    patterns: readonly string[],
  ): Promise<RequiredMajorVersion> {
    const versionFile = await this.findConfigFile(patterns);
    if (!versionFile) {
      return undefined;
    }

    try {
      const content = await readFile(versionFile, "utf8");
      const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? "";
      if (!firstLine) {
        return "invalid";
      }

      const match = firstLine.match(/[0-9]+/);
      return match ? match[0] : "invalid";
    } catch {
      return "invalid";
    }
  }

  private async resolveInstalledToolMajorVersion(
    command: string,
  ): Promise<string | undefined> {
    const result = await this.exec(command, ["--version"]);
    if (result.code !== 0) {
      return undefined;
    }

    const output = `${result.stdout}\n${result.stderr}`;
    const match = output.match(/version\s+([0-9]+)/i);
    return match?.[1];
  }
}
