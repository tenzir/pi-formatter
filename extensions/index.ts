import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { commandTimeoutMs } from "./format/config.js";
import { formatFile } from "./format/dispatch.js";
import { pathExists, resolveToolPath } from "./format/path.js";
import type { SourceTool } from "./format/types.js";

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function (pi: ExtensionAPI) {
  const formatQueueByPath = new Map<string, Promise<void>>();

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

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError) {
      return;
    }

    if (event.toolName !== "write" && event.toolName !== "edit") {
      return;
    }

    const rawPath = (event.input as { path?: unknown }).path;
    if (typeof rawPath !== "string" || rawPath.length === 0) {
      return;
    }

    const sourceTool = event.toolName as SourceTool;
    const filePath = resolveToolPath(rawPath, ctx.cwd);

    if (!(await pathExists(filePath))) {
      return;
    }

    await enqueueFormat(filePath, async () => {
      try {
        await formatFile(pi, ctx.cwd, sourceTool, filePath, commandTimeoutMs);
      } catch (error) {
        console.warn(
          `[pi-formatter] Failed to format ${filePath}: ${formatError(error)}`,
        );
      }
    });
  });
}
