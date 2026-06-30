import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function atomicWrite(filePath: string, data: string, mode: number): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o755 });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, data, { mode });
  await fs.rename(tempPath, filePath);
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
