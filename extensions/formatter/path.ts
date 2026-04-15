import { access, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileKind } from "./types.js";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

function normalizeUnicodeSpaces(value: string): string {
  return value.replace(UNICODE_SPACES, " ");
}

export function normalizeToolPath(filePath: string): string {
  const normalizedInput = normalizeUnicodeSpaces(filePath);
  const normalizedAt = normalizedInput.startsWith("@")
    ? normalizedInput.slice(1)
    : normalizedInput;

  if (normalizedAt === "~") {
    return homedir();
  }

  if (normalizedAt.startsWith("~/")) {
    return join(homedir(), normalizedAt.slice(2));
  }

  return normalizedAt;
}

export function resolveToolPath(filePath: string, cwd: string): string {
  const normalizedPath = normalizeToolPath(filePath);
  return isAbsolute(normalizedPath)
    ? normalizedPath
    : resolve(cwd, normalizedPath);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function isWithinDirectory(
  pathToCheck: string,
  directory: string,
): boolean {
  const relPath = relative(directory, pathToCheck);
  return (
    relPath === "" ||
    relPath === "." ||
    (!relPath.startsWith("..") && !isAbsolute(relPath))
  );
}

export function getRelativePathOrAbsolute(
  filePath: string,
  directory: string,
): string {
  const relPath = relative(directory, filePath);
  if (
    !relPath ||
    relPath === "." ||
    relPath.startsWith("..") ||
    isAbsolute(relPath)
  ) {
    return filePath;
  }

  return relPath;
}

export async function isPathInFormattingScope(
  filePath: string,
  cwd: string,
): Promise<boolean> {
  const rootPath = resolve(cwd);
  const candidatePath = resolve(filePath);

  if (!isWithinDirectory(candidatePath, rootPath)) {
    return false;
  }

  const relPath = relative(rootPath, candidatePath);
  if (!relPath || relPath === ".") {
    return false;
  }

  let currentPath = rootPath;

  for (const segment of relPath.split(sep)) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    currentPath = join(currentPath, segment);

    try {
      if ((await lstat(currentPath)).isSymbolicLink()) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

export function detectFileKind(filePath: string): FileKind | undefined {
  if (
    /(\.(c|h|cc|hh|cpp|hpp|cxx|hxx|ixx|ipp|inl|tpp)|\.(c|h|cc|hh|cpp|hpp|cxx|hxx)\.in)$/i.test(
      filePath,
    )
  ) {
    return "cxx";
  }

  if (/\.cmake$/.test(filePath) || basename(filePath) === "CMakeLists.txt") {
    return "cmake";
  }

  if (/\.(md|mdx)$/.test(filePath)) {
    return "markdown";
  }

  if (/\.json$/.test(filePath)) {
    return "json";
  }

  if (/\.(sh|bash)$/.test(filePath)) {
    return "shell";
  }

  if (/\.py$/.test(filePath)) {
    return "python";
  }

  if (/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(filePath)) {
    return "jsts";
  }

  return undefined;
}
