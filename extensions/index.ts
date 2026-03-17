import { basename } from "node:path";
import {
  type ExtensionAPI,
  getSettingsListTheme,
  isEditToolResult,
  isWriteToolResult,
} from "@mariozechner/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@mariozechner/pi-tui";
import {
  cloneFormatterConfig,
  type FormatterConfigSnapshot,
  getFormatterConfigPath,
  loadFormatterConfig,
  writeFormatterConfigSnapshot,
} from "./formatter/config.js";
import { type FormatCallSummary, formatFile } from "./formatter/dispatch.js";
import {
  getPathForGit,
  pathExists,
  resolveToolPath,
} from "./formatter/path.js";

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSummaryPath(filePath: string, cwd: string): string {
  const pathForDisplay = getPathForGit(filePath, cwd);
  return pathForDisplay.startsWith("/")
    ? basename(pathForDisplay)
    : pathForDisplay;
}

function formatCallSuccessSummary(summary: FormatCallSummary): string {
  return `✔︎ ${summary.runnerId}`;
}

function formatCallFailureSummary(summary: FormatCallSummary): string {
  if (summary.failureMessage) {
    return `✘ ${summary.runnerId}: ${summary.failureMessage}`;
  }

  if (summary.exitCode !== undefined) {
    return `✘ ${summary.runnerId} (exit ${summary.exitCode})`;
  }

  return `✘ ${summary.runnerId}`;
}

function resolveEventPath(rawPath: unknown, cwd: string): string | undefined {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    return undefined;
  }

  return resolveToolPath(rawPath, cwd);
}

function getFormatterSettingItems(
  config: FormatterConfigSnapshot,
): SettingItem[] {
  const timeoutValues = ["2000", "5000", "10000", "30000", "60000"];

  if (!timeoutValues.includes(String(config.commandTimeoutMs))) {
    timeoutValues.push(String(config.commandTimeoutMs));
    timeoutValues.sort(
      (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
    );
  }

  return [
    {
      id: "formatMode",
      label: "Format mode",
      description:
        "Choose whether formatting runs after each successful write/edit tool call or once after the agent stops.",
      currentValue: config.formatMode,
      values: ["afterEachToolCall", "afterAgentStop"],
    },
    {
      id: "formatOnAbort",
      label: "Format on abort",
      description:
        "When enabled, deferred formatting also runs if the model is interrupted or cancelled.",
      currentValue: config.formatOnAbort ? "on" : "off",
      values: ["off", "on"],
    },
    {
      id: "commandTimeoutMs",
      label: "Command timeout",
      description: "Maximum runtime per formatter command in milliseconds.",
      currentValue: String(config.commandTimeoutMs),
      values: timeoutValues,
    },
    {
      id: "hideCallSummariesInTui",
      label: "Hide TUI summaries",
      description:
        "Hide per-run formatter pass/fail summaries in the interactive UI.",
      currentValue: config.hideCallSummariesInTui ? "on" : "off",
      values: ["off", "on"],
    },
  ];
}

export default function (pi: ExtensionAPI) {
  let formatterConfig = loadFormatterConfig();
  const formatQueueByPath = new Map<string, Promise<void>>();
  const candidatePaths = new Set<string>();
  const successfulPaths = new Set<string>();

  const enqueueFormat = async (
    filePath: string,
    run: () => Promise<void>,
  ): Promise<void> => {
    const previous = formatQueueByPath.get(filePath) ?? Promise.resolve();
    const next = previous
      .catch(() => {
        // Keep the queue alive after a failure.
      })
      .then(run)
      .finally(() => {
        if (formatQueueByPath.get(filePath) === next) {
          formatQueueByPath.delete(filePath);
        }
      });

    formatQueueByPath.set(filePath, next);
    await next;
  };

  const formatResolvedPath = async (
    filePath: string,
    ctx: {
      cwd: string;
      hasUI: boolean;
      ui: {
        notify(message: string, level: "info" | "warning" | "error"): void;
      };
    },
  ): Promise<void> => {
    if (!(await pathExists(filePath))) {
      return;
    }

    const showSummaries = !formatterConfig.hideCallSummariesInTui && ctx.hasUI;
    const notifyWarning = (message: string) => {
      const normalizedMessage = message.replace(/\s+/g, " ").trim();

      if (ctx.hasUI) {
        ctx.ui.notify(normalizedMessage, "warning");
        return;
      }

      console.warn(normalizedMessage);
    };

    await enqueueFormat(filePath, async () => {
      const summaries: FormatCallSummary[] = [];
      const summaryReporter = showSummaries
        ? (summary: FormatCallSummary) => {
            summaries.push(summary);
          }
        : undefined;

      const runnerWarningReporter =
        showSummaries && ctx.hasUI
          ? () => {
              // Summary mode already reports failures compactly.
            }
          : notifyWarning;

      try {
        await formatFile(
          pi,
          ctx.cwd,
          filePath,
          formatterConfig.commandTimeoutMs,
          summaryReporter,
          runnerWarningReporter,
        );
      } catch (error) {
        const fileLabel = formatSummaryPath(filePath, ctx.cwd);
        notifyWarning(`Failed to format ${fileLabel}: ${formatError(error)}`);
      }

      if (!showSummaries || summaries.length === 0) {
        return;
      }

      for (const summary of summaries) {
        if (summary.status === "succeeded") {
          ctx.ui.notify(formatCallSuccessSummary(summary), "info");
          continue;
        }

        ctx.ui.notify(formatCallFailureSummary(summary), "info");
      }
    });
  };

  const reloadFormatterConfig = () => {
    formatterConfig = loadFormatterConfig();
  };

  pi.on("agent_start", async () => {
    candidatePaths.clear();
    successfulPaths.clear();
  });

  pi.on("tool_call", async (event, ctx) => {
    if (formatterConfig.formatMode !== "afterAgentStop") {
      return;
    }

    if (event.toolName !== "write" && event.toolName !== "edit") {
      return;
    }

    const filePath = resolveEventPath(event.input.path, ctx.cwd);
    if (filePath) {
      candidatePaths.add(filePath);
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!isWriteToolResult(event) && !isEditToolResult(event)) {
      return;
    }

    const filePath = resolveEventPath(event.input.path, ctx.cwd);
    if (!filePath) {
      return;
    }

    if (!event.isError) {
      successfulPaths.add(filePath);
    }

    if (formatterConfig.formatMode !== "afterEachToolCall" || event.isError) {
      return;
    }

    await formatResolvedPath(filePath, ctx);
  });

  pi.on("agent_end", async (event, ctx) => {
    if (formatterConfig.formatMode !== "afterAgentStop") {
      candidatePaths.clear();
      successfulPaths.clear();
      return;
    }

    let lastAssistantStopReason: string | undefined;
    for (let index = event.messages.length - 1; index >= 0; index -= 1) {
      const message = event.messages[index];
      if (message.role !== "assistant") {
        continue;
      }

      lastAssistantStopReason = message.stopReason;
      break;
    }

    const pathsToFormat = new Set<string>();
    if (lastAssistantStopReason === "aborted") {
      if (formatterConfig.formatOnAbort) {
        for (const filePath of candidatePaths) {
          pathsToFormat.add(filePath);
        }
        for (const filePath of successfulPaths) {
          pathsToFormat.add(filePath);
        }
      }
    } else {
      for (const filePath of successfulPaths) {
        pathsToFormat.add(filePath);
      }
    }

    candidatePaths.clear();
    successfulPaths.clear();

    for (const filePath of pathsToFormat) {
      await formatResolvedPath(filePath, ctx);
    }
  });

  pi.registerCommand("formatter", {
    description: "Configure formatter behavior.",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        console.warn("/formatter requires interactive UI mode");
        return;
      }

      const configPath = getFormatterConfigPath();
      reloadFormatterConfig();
      const draft = cloneFormatterConfig(formatterConfig);

      await ctx.ui.custom((tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(
          new Text(theme.fg("accent", theme.bold("Formatter Settings")), 1, 0),
        );
        container.addChild(new Text(theme.fg("dim", configPath), 1, 0));
        container.addChild(new Text("", 0, 0));

        const syncDraftToSettingsList = (settingsList: SettingsList) => {
          settingsList.updateValue("formatMode", draft.formatMode);
          settingsList.updateValue(
            "formatOnAbort",
            draft.formatOnAbort ? "on" : "off",
          );
          settingsList.updateValue(
            "commandTimeoutMs",
            String(draft.commandTimeoutMs),
          );
          settingsList.updateValue(
            "hideCallSummariesInTui",
            draft.hideCallSummariesInTui ? "on" : "off",
          );
        };

        const settingsList = new SettingsList(
          getFormatterSettingItems(draft),
          8,
          getSettingsListTheme(),
          (id, newValue) => {
            const previous = cloneFormatterConfig(draft);

            if (id === "formatMode") {
              draft.formatMode = newValue as FormatterConfigSnapshot["formatMode"];
            } else if (id === "formatOnAbort") {
              draft.formatOnAbort = newValue === "on";
            } else if (id === "commandTimeoutMs") {
              draft.commandTimeoutMs = Number.parseInt(newValue, 10);
            } else if (id === "hideCallSummariesInTui") {
              draft.hideCallSummariesInTui = newValue === "on";
            }

            try {
              writeFormatterConfigSnapshot(draft);
              reloadFormatterConfig();
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              draft.commandTimeoutMs = previous.commandTimeoutMs;
              draft.hideCallSummariesInTui = previous.hideCallSummariesInTui;
              draft.formatMode = previous.formatMode;
              draft.formatOnAbort = previous.formatOnAbort;
              syncDraftToSettingsList(settingsList);
              ctx.ui.notify(`Failed to save config: ${message}`, "error");
            }
          },
          () => {
            done(undefined);
          },
        );

        container.addChild(settingsList);

        return {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            settingsList.handleInput?.(data);
            tui.requestRender();
          },
        };
      });
    },
  });
}
