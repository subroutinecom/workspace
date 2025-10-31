import { test as base } from 'vitest';
import {
  createTestWorkspace,
  startWorkspace,
  stopWorkspace,
  cleanupTestWorkspace,
  generateTestWorkspaceName,
  execInWorkspace,
  readFileInWorkspace,
  fileExistsInWorkspace,
} from '../helpers/workspace-utils.js';

export const test = base.extend({
  workspace: async ({}, use) => {
    const name = generateTestWorkspaceName('test');
    let workspaceDir = null;

    const api = {
      name,
      async create(config = {}, scripts = {}) {
        workspaceDir = await createTestWorkspace(name, config, scripts);
        return workspaceDir;
      },
      async start(options = {}) {
        return startWorkspace(name, options);
      },
      async stop() {
        return stopWorkspace(name);
      },
      exec(command, options = {}) {
        return execInWorkspace(name, command, options);
      },
      readFile(filePath) {
        return readFileInWorkspace(name, filePath);
      },
      fileExists(filePath) {
        return fileExistsInWorkspace(name, filePath);
      },
    };

    await use(api);

    await cleanupTestWorkspace(name);
  },
});
