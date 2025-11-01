import { describe, expect, beforeAll, afterAll } from 'vitest';
import { test } from '../fixtures/workspace.js';
import {
  generateTestWorkspaceName,
  createTestWorkspace,
  startWorkspace,
  cleanupTestWorkspace,
  execInWorkspace,
  fileExistsInWorkspace,
  execWorkspace,
} from '../helpers/workspace-utils.js';
import path from 'path';

describe('Workspace Validation', () => {
  let currentWorkspace = null;

  beforeAll(async () => {
    currentWorkspace = generateTestWorkspaceName('workspace-validation');

    console.log('\n📝 Creating test workspace...');
    await createTestWorkspace(
      currentWorkspace,
      {
        forwards: [
          3000,
          '5000-5003',
          8080,
          '9000-9001',
          '7000-7000',
        ],
      },
      {}
    );

    console.log('🚀 Starting workspace...');
    startWorkspace(currentWorkspace);
  });

  afterAll(async () => {
    console.log('\n🧹 Cleaning up test workspace...');
    if (currentWorkspace) {
      await cleanupTestWorkspace(currentWorkspace);
    }
  });

  test('should have Neovim installed with correct version', async () => {
    console.log('\n  ✓ Checking Neovim installation...');

    const nvimVersion = execInWorkspace(currentWorkspace, 'nvim --version');
    expect(nvimVersion).toContain('NVIM');

    const versionMatch = nvimVersion.match(/NVIM v(\d+\.\d+\.\d+)/);
    expect(versionMatch).toBeTruthy();

    const version = versionMatch[1];
    const [major, minor] = version.split('.').map(Number);

    expect(major > 0 || (major === 0 && minor >= 9)).toBe(true);

    console.log(`    → Neovim v${version} installed ✓`);
  });

  test('should have LazyVim configured', async () => {
    console.log('  ✓ Checking LazyVim configuration...');

    const hasConfig = fileExistsInWorkspace(
      currentWorkspace,
      '/home/workspace/.config/nvim/init.lua'
    );
    expect(hasConfig).toBe(true);

    const hasLuaConfig = fileExistsInWorkspace(
      currentWorkspace,
      '/home/workspace/.config/nvim/lua/config/lazy.lua'
    );
    expect(hasLuaConfig).toBe(true);

    console.log('    → LazyVim configured ✓');
  });

  test('should have required CLI tools installed', async () => {
    console.log('  ✓ Checking CLI tools...');

    const tools = [
      { cmd: 'rg --version', check: 'ripgrep', name: 'ripgrep' },
      { cmd: 'fdfind --version', check: 'fdfind', name: 'fd-find' },
      { cmd: 'git --version', check: 'git version', name: 'Git' },
      { cmd: 'node --version', check: 'v', name: 'Node.js' },
      { cmd: 'npm --version', check: /^\d+\.\d+\.\d+/, name: 'npm' },
      { cmd: 'python3 --version', check: 'Python', name: 'Python 3' },
      { cmd: 'gh --version', check: 'gh version', name: 'GitHub CLI' },
      { cmd: 'opencode --version', check: /\d+\.\d+\.\d+/, name: 'opencode' },
    ];

    for (const tool of tools) {
      const output = execInWorkspace(currentWorkspace, tool.cmd);
      if (typeof tool.check === 'string') {
        expect(output).toContain(tool.check);
      } else {
        expect(tool.check.test(output)).toBe(true);
      }
    }

    console.log('    → All CLI tools present ✓');
  });

  test('should have Docker-in-Docker working', async () => {
    console.log('  ✓ Checking Docker-in-Docker...');

    const dockerVersion = execInWorkspace(currentWorkspace, 'docker --version');
    expect(dockerVersion).toContain('Docker version');

    let dockerReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        const dockerInfo = execInWorkspace(currentWorkspace, 'docker info');
        if (dockerInfo.includes('Server Version')) {
          dockerReady = true;
          break;
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    expect(dockerReady).toBe(true);
    console.log('    → Docker-in-Docker working ✓');
  });

  test('should have workspace user with proper permissions', async () => {
    console.log('  ✓ Checking workspace user...');

    const whoami = execInWorkspace(currentWorkspace, 'whoami');
    expect(whoami.trim()).toBe('workspace');

    const sudoTest = execInWorkspace(currentWorkspace, 'sudo -n whoami');
    expect(sudoTest.trim()).toBe('root');

    const groups = execInWorkspace(currentWorkspace, 'groups');
    expect(groups).toContain('docker');

    console.log('    → User permissions configured correctly ✓');
  });

  test('should have home directory with proper structure', async () => {
    console.log('  ✓ Checking home directory structure...');

    const hasConfig = fileExistsInWorkspace(
      currentWorkspace,
      '/home/workspace/.config/nvim/init.lua'
    );
    expect(hasConfig).toBe(true);

    const hasBashrc = fileExistsInWorkspace(
      currentWorkspace,
      '/home/workspace/.bashrc'
    );
    expect(hasBashrc).toBe(true);

    console.log('    → Home directory structure correct ✓');
  });

  test('should expand port ranges correctly', async () => {
    console.log('  ✓ Verifying port range expansion...');

    const expectedPorts = [3000, 5000, 5001, 5002, 5003, 8080, 9000, 9001, 7000];
    const workspacePath = path.join('/tmp', 'workspace-test-workspaces', currentWorkspace);
    const statusOutput = execWorkspace(`status ${currentWorkspace} --path ${workspacePath}`);

    console.log('  ✓ Verifying all expanded ports are present...');
    expectedPorts.forEach((port) => {
      expect(statusOutput).toContain(String(port));
    });

    const forwardLines = statusOutput.split('\n').filter((line) => line.includes('Forward'));
    expect(forwardLines.length).toBe(expectedPorts.length);

    console.log(`    → Successfully expanded to ${expectedPorts.length} ports ✓`);
    console.log(`    → Individual ports: 3000, 8080 ✓`);
    console.log(`    → Multi-port range (5000-5003): 5000, 5001, 5002, 5003 ✓`);
    console.log(`    → Small range (9000-9001): 9000, 9001 ✓`);
    console.log(`    → Single-port range (7000-7000): 7000 ✓`);
  });
});
