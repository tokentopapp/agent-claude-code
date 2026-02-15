import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export const CLAUDE_CODE_HOME = path.join(os.homedir(), '.claude');
export const CLAUDE_CODE_PROJECTS_PATH = path.join(CLAUDE_CODE_HOME, 'projects');

export async function getProjectDirs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(CLAUDE_CODE_PROJECTS_PATH, { withFileTypes: true });
    const dirs: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirs.push(path.join(CLAUDE_CODE_PROJECTS_PATH, entry.name));
      }
    }

    return dirs;
  } catch {
    return [];
  }
}
