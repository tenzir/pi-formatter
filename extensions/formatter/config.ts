import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

export type FormatMode = "tool" | "prompt" | "session";

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const DEFAULT_HIDE_CALL_SUMMARIES_IN_TUI = false;
export const DEFAULT_FORMAT_MODE: FormatMode = "prompt";
const FORMATTER_CONFIG_FILE = "formatter.json";

export type FormatterConfigSnapshot = {
  commandTimeoutMs: number;
  hideCallSummariesInTui: boolean;
  formatMode: FormatMode;
};

export const DEFAULT_FORMATTER_CONFIG: FormatterConfigSnapshot = {
  commandTimeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
  hideCallSummariesInTui: DEFAULT_HIDE_CALL_SUMMARIES_IN_TUI,
  formatMode: DEFAULT_FORMAT_MODE,
};

export function getFormatterConfigPath(): string {
  return join(getAgentDir(), FORMATTER_CONFIG_FILE);
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
  try {
    if (!existsSync(filePath)) {
      return undefined;
    }

    const content = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function parsePositiveInt(value: unknown, defaultValue: number): number {
  if (typeof value !== "number") {
    return defaultValue;
  }

  if (!Number.isInteger(value) || value <= 0) {
    return defaultValue;
  }

  return value;
}

function parseBooleanValue(value: unknown, defaultValue: boolean): boolean {
  if (typeof value !== "boolean") {
    return defaultValue;
  }

  return value;
}

function parseFormatMode(value: unknown, defaultValue: FormatMode): FormatMode {
  if (value === "tool" || value === "prompt" || value === "session") {
    return value;
  }

  return defaultValue;
}

function toFormatterConfigObject(
  config: FormatterConfigSnapshot,
): Record<string, unknown> {
  return {
    commandTimeoutMs: config.commandTimeoutMs,
    hideCallSummariesInTui: config.hideCallSummariesInTui,
    formatMode: config.formatMode,
  };
}

function writeFormatterConfigFile(content: string): void {
  mkdirSync(getAgentDir(), { recursive: true });
  writeFileSync(getFormatterConfigPath(), content, "utf8");
}

export function loadFormatterConfig(): FormatterConfigSnapshot {
  const config = readJsonObject(getFormatterConfigPath());

  if (!config) {
    return { ...DEFAULT_FORMATTER_CONFIG };
  }

  return {
    commandTimeoutMs: parsePositiveInt(
      config.commandTimeoutMs,
      DEFAULT_COMMAND_TIMEOUT_MS,
    ),
    hideCallSummariesInTui: parseBooleanValue(
      config.hideCallSummariesInTui,
      DEFAULT_HIDE_CALL_SUMMARIES_IN_TUI,
    ),
    formatMode: parseFormatMode(config.formatMode, DEFAULT_FORMAT_MODE),
  };
}

export function cloneFormatterConfig(
  config: FormatterConfigSnapshot,
): FormatterConfigSnapshot {
  return {
    commandTimeoutMs: config.commandTimeoutMs,
    hideCallSummariesInTui: config.hideCallSummariesInTui,
    formatMode: config.formatMode,
  };
}

export function writeFormatterConfigSnapshot(
  config: FormatterConfigSnapshot,
): void {
  writeFormatterConfigFile(
    `${JSON.stringify(toFormatterConfigObject(config), null, 2)}\n`,
  );
}
