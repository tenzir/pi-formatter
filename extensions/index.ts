import {
  type ExtensionAPI,
  getSettingsListTheme,
  isEditToolResult,
  isWriteToolResult,
} from "@mariozechner/pi-coding-agent";
import {
  Container,
  type SettingItem,
  SettingsList,
  Text,
} from "@mariozechner/pi-tui";
import {
  cloneFormatterConfig,
  type FormatterConfigSnapshot,
  getFormatterConfigPath,
  loadFormatterConfig,
  writeFormatterConfigSnapshot,
} from "./formatter/config.js";
import { type FormatCallSummary, formatFile } from "./formatter/dispatch.js";
import {
  getRelativePathOrAbsolute,
  isPathInFormattingScope,
  resolveToolPath,
} from "./formatter/path.js";

function normalizeSummaryMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatCallSummary(
  summary: FormatCallSummary,
  fileLabel: string,
): string {
  const prefix = summary.status === "succeeded" ? "✔︎" : "✘";
  const base = `${prefix} ${summary.runnerId}: ${fileLabel}`;

  if (summary.status === "succeeded") {
    return base;
  }

  if (summary.failureMessage) {
    return `${base}: ${normalizeSummaryMessage(summary.failureMessage)}`;
  }

  if (summary.exitCode !== undefined) {
    return `${base} (exit ${summary.exitCode})`;
  }

  return base;
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
        "Choose whether formatting runs after each successful write/edit tool call, once after each prompt completes, or once when the session shuts down.",
      currentValue: config.formatMode,
      values: ["tool", "prompt", "session"],
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

type FormatterContext = {
  cwd: string;
  hasUI: boolean;
  ui: {
    notify(message: string, level: "info" | "warning" | "error"): void;
  };
};

export default function (pi: ExtensionAPI) {
  let formatterConfig = loadFormatterConfig();
  const formatQueueByPath = new Map<string, Promise<void>>();
  const pendingPromptPaths = new Set<string>();
  const pendingSessionPaths = new Set<string>();

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

  const emitSummaryMessages = (
    messages: string[],
    ctx: FormatterContext,
  ): void => {
    if (
      !ctx.hasUI ||
      formatterConfig.hideCallSummariesInTui ||
      messages.length === 0
    ) {
      return;
    }

    ctx.ui.notify(messages.join("\n"), "info");
  };

  const formatResolvedPath = async (
    filePath: string,
    ctx: FormatterContext,
  ): Promise<string[]> => {
    if (!(await isPathInFormattingScope(filePath, ctx.cwd))) {
      return [];
    }

    const showSummaries = !formatterConfig.hideCallSummariesInTui && ctx.hasUI;
    const notifyWarning = (message: string) => {
      const normalizedMessage = normalizeSummaryMessage(message);

      if (ctx.hasUI) {
        ctx.ui.notify(normalizedMessage, "warning");
        return;
      }

      console.warn(normalizedMessage);
    };

    let summaryMessages: string[] = [];

    await enqueueFormat(filePath, async () => {
      const summaries: FormatCallSummary[] = [];
      const summaryReporter = showSummaries
        ? (summary: FormatCallSummary) => {
            summaries.push(summary);
          }
        : undefined;

      const runnerWarningReporter = showSummaries
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
        const fileLabel = getRelativePathOrAbsolute(filePath, ctx.cwd);
        notifyWarning(`Failed to format ${fileLabel}: ${formatError(error)}`);
      }

      if (!showSummaries || summaries.length === 0) {
        return;
      }

      const fileLabel = getRelativePathOrAbsolute(filePath, ctx.cwd);
      summaryMessages = summaries.map((summary) =>
        formatCallSummary(summary, fileLabel),
      );
    });

    return summaryMessages;
  };

  const flushPaths = async (
    paths: Set<string>,
    ctx: FormatterContext,
  ): Promise<string[]> => {
    const batch = [...paths];
    paths.clear();

    const summaryMessages: string[] = [];

    for (const filePath of batch) {
      summaryMessages.push(...(await formatResolvedPath(filePath, ctx)));
    }

    return summaryMessages;
  };

  const flushPendingPaths = async (ctx: FormatterContext): Promise<void> => {
    const summaryMessages = [
      ...(await flushPaths(pendingPromptPaths, ctx)),
      ...(await flushPaths(pendingSessionPaths, ctx)),
    ];

    emitSummaryMessages(summaryMessages, ctx);
  };

  const reloadFormatterConfig = () => {
    formatterConfig = loadFormatterConfig();
  };

  pi.on("tool_result", async (event, ctx) => {
    if (!isWriteToolResult(event) && !isEditToolResult(event)) {
      return;
    }

    if (event.isError) {
      return;
    }

    const filePath = resolveEventPath(event.input.path, ctx.cwd);
    if (!filePath || !(await isPathInFormattingScope(filePath, ctx.cwd))) {
      return;
    }

    if (formatterConfig.formatMode === "tool") {
      emitSummaryMessages(await formatResolvedPath(filePath, ctx), ctx);
      return;
    }

    if (formatterConfig.formatMode === "prompt") {
      pendingPromptPaths.add(filePath);
      return;
    }

    pendingSessionPaths.add(filePath);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (pendingPromptPaths.size === 0) {
      return;
    }

    emitSummaryMessages(await flushPaths(pendingPromptPaths, ctx), ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    if (pendingPromptPaths.size === 0 && pendingSessionPaths.size === 0) {
      return;
    }

    await flushPendingPaths(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (pendingPromptPaths.size === 0 && pendingSessionPaths.size === 0) {
      return;
    }

    await flushPendingPaths(ctx);
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
              draft.formatMode =
                newValue as FormatterConfigSnapshot["formatMode"];
            } else if (id === "commandTimeoutMs") {
              draft.commandTimeoutMs = Number.parseInt(newValue, 10);
            } else if (id === "hideCallSummariesInTui") {
              draft.hideCallSummariesInTui = newValue === "on";
            }

            try {
              writeFormatterConfigSnapshot(draft);
              reloadFormatterConfig();

              if (
                id === "formatMode" &&
                previous.formatMode !== draft.formatMode
              ) {
                void flushPendingPaths(ctx).catch((error) => {
                  const message =
                    error instanceof Error ? error.message : String(error);
                  ctx.ui.notify(
                    `Failed to flush pending formats: ${message}`,
                    "error",
                  );
                });
              }
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              draft.commandTimeoutMs = previous.commandTimeoutMs;
              draft.hideCallSummariesInTui = previous.hideCallSummariesInTui;
              draft.formatMode = previous.formatMode;
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
