import { promises as fs } from 'node:fs';
import path from 'node:path';
import { git, identityArgs } from '../git/worktrees';

export interface NewProjectInput { parentDir: string; name: string; brief?: string }

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A folder name that is valid on macOS, Windows and Linux. Throws a readable error otherwise. */
export function projectFolderName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new Error('Give the project a name');
  if (name.length > 60) throw new Error('Keep the project name to 60 characters or fewer');
  if (name === '.' || name === '..' || ILLEGAL.test(name)) throw new Error('The project name can’t contain / \\ : * ? " < > | or control characters');
  if (RESERVED.test(name)) throw new Error(`"${name}" is a reserved name on Windows; pick another`);
  if (/[. ]$/.test(name)) throw new Error('The project name can’t end with a dot or a space');
  return name;
}

/** Creates `<parentDir>/<name>` as a git repo on `main` with a README, .gitignore and a first commit. */
export async function createRepo(input: NewProjectInput): Promise<string> {
  const name = projectFolderName(input.name);
  const parent = path.resolve(input.parentDir);
  const stat = await fs.stat(parent).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Location ${parent} does not exist or is not a folder`);
  const dir = path.join(parent, name);
  const existing = await fs.readdir(dir).catch(() => null);
  if (existing && existing.length > 0) throw new Error(`A folder named "${name}" already exists in ${parent} and is not empty. Pick another name or open it as an existing project.`);
  await fs.mkdir(dir, { recursive: true });
  await git(dir, ['init', '-q', '-b', 'main']);
  const brief = input.brief?.trim();
  await fs.writeFile(path.join(dir, 'README.md'), `# ${name}\n${brief ? `\n${brief}\n` : ''}`);
  await fs.writeFile(path.join(dir, '.gitignore'), ['.DS_Store', 'node_modules/', '.env', 'dist/', ''].join('\n'));
  await git(dir, ['add', '-A']);
  await git(dir, [...(await identityArgs(dir)), 'commit', '-q', '-m', 'Initial commit']);
  return dir;
}
