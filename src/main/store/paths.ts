import path from 'node:path';

export interface DataPaths {
  root: string;
  settingsFile: string;
  rolesDir: string;
  skillsDir: string;
  projectsDir: string;
  promptDir: string;
  projectDir(projectId: string): string;
  projectFile(projectId: string): string;
  agentsFile(projectId: string): string;
  tasksFile(projectId: string): string;
  chatFile(projectId: string): string;
  logFile(projectId: string, agentId: string): string;
}

export function dataPaths(root: string): DataPaths {
  const projectsDir = path.join(root, 'projects');
  const projectDir = (id: string) => path.join(projectsDir, id);
  return {
    root,
    settingsFile: path.join(root, 'settings.json'),
    rolesDir: path.join(root, 'roles'),
    skillsDir: path.join(root, 'skills'),
    projectsDir,
    promptDir: path.join(root, 'prompts'),
    projectDir,
    projectFile: (id) => path.join(projectDir(id), 'project.json'),
    agentsFile: (id) => path.join(projectDir(id), 'agents.json'),
    tasksFile: (id) => path.join(projectDir(id), 'tasks.json'),
    chatFile: (id) => path.join(projectDir(id), 'chat.jsonl'),
    logFile: (id, agentId) => path.join(projectDir(id), 'logs', `${agentId}.jsonl`),
  };
}
