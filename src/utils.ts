import * as fs from 'fs/promises';

export async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const rows: T[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        rows.push(JSON.parse(trimmed) as T);
      } catch {
      }
    }

    return rows;
  } catch {
    return [];
  }
}

export function decodeProjectDirName(dirName: string): string {
  if (!dirName) return dirName;
  if (!dirName.startsWith('-')) return dirName.replace(/-/g, '/');

  const segments = dirName.split('-').filter((segment) => segment.length > 0);
  return `/${segments.join('/')}`;
}

export function extractProjectPath(entries: Array<{ cwd?: string }>): string | undefined {
  for (const entry of entries) {
    const cwd = entry.cwd?.trim();
    if (cwd) return cwd;
  }
  return undefined;
}
