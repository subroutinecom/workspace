import { describe, expect } from 'vitest';
import { test } from '../fixtures/workspace.js';
import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';

describe('Bootstrap Scripts E2E', () => {
  test('bootstrap scripts - execution, restart, and error handling', async ({ workspace }) => {
    const scripts = {
      '01-first.sh': `#!/bin/bash
set -e
echo "first" > /home/workspace/order.txt
echo "Script 1 executed" >> /home/workspace/bootstrap.log
echo "HOME=$HOME" >> /home/workspace/env.txt
echo "USER=$USER" >> /home/workspace/env.txt
echo "PWD=$(pwd)" >> /home/workspace/env.txt
`,
      '02-second.sh': `#!/bin/bash
set -e
echo "second" >> /home/workspace/order.txt
echo "Script 2 executed" >> /home/workspace/bootstrap.log
`,
      '03-sudo-test.sh': `#!/bin/bash
set -e
echo "third" >> /home/workspace/order.txt
echo "Testing sudo access..." >> /home/workspace/bootstrap.log
sudo whoami > /home/workspace/sudo-test.txt
echo "Script 3 executed" >> /home/workspace/bootstrap.log
`,
      '04-mount-test.sh': `#!/bin/bash
set -e
if [ -f /workspace/source/.workspace.yml ]; then
  echo "can-access-source" > /home/workspace/mount-test.txt
else
  echo "cannot-access-source" > /home/workspace/mount-test.txt
fi
echo "Script 4 executed" >> /home/workspace/bootstrap.log
`,
    };

    const workspaceDir = await workspace.create({}, scripts);

    await fs.writeFile(path.join(workspaceDir, 'scripts', 'nonexec.sh'), `#!/bin/bash\necho "This should not run"\n`);
    await fs.chmod(path.join(workspaceDir, 'scripts', 'nonexec.sh'), 0o644);

    await workspace.start();

    const orderFile = workspace.readFile('/home/workspace/order.txt');
    const lines = orderFile.split('\n').filter((l) => l.trim());
    expect(lines).toEqual(['first', 'second', 'third']);

    const logFile = workspace.readFile('/home/workspace/bootstrap.log');
    expect(logFile).toContain('Script 1 executed');
    expect(logFile).toContain('Script 2 executed');
    expect(logFile).toContain('Script 3 executed');
    expect(logFile).toContain('Script 4 executed');

    const envFile = workspace.readFile('/home/workspace/env.txt');
    expect(envFile).toContain('HOME=/home/workspace');
    expect(envFile).toContain('PWD=/home/workspace');
    expect(envFile).toContain('USER=');

    const sudoTest = workspace.readFile('/home/workspace/sudo-test.txt');
    expect(sudoTest.trim()).toBe('root');

    const mountTest = workspace.readFile('/home/workspace/mount-test.txt');
    expect(mountTest).toBe('can-access-source');

    expect(workspace.fileExists('/home/workspace/.workspace-initialized')).toBe(true);

    const beforeRestart = workspace.readFile('/home/workspace/order.txt');

    await workspace.stop();
    await workspace.start();

    const afterRestart = workspace.readFile('/home/workspace/order.txt');
    expect(afterRestart).toBe(beforeRestart);

    const linesAfterRestart = afterRestart.split('\n').filter((l) => l.trim());
    expect(linesAfterRestart).toHaveLength(3);

    const containerName = `workspace-${workspace.name}`;
    const missingScriptConfig = path.join(workspaceDir, '.workspace-missing.yml');
    await fs.writeFile(missingScriptConfig, `bootstrap:\n  scripts:\n    - scripts/nonexistent.sh\n`);

    let missingScriptError = null;
    try {
      execSync(`cd ${workspaceDir} && node ${path.join(__dirname, '../../dist/index.js')} start --config .workspace-missing.yml --force-recreate --no-shell`, {
        stdio: 'pipe',
      });
    } catch (err) {
      missingScriptError = err;
    }
    expect(missingScriptError).not.toBeNull();

    const nonexecConfig = path.join(workspaceDir, '.workspace-nonexec.yml');
    await fs.writeFile(nonexecConfig, `bootstrap:\n  scripts:\n    - scripts/nonexec.sh\n`);

    let nonexecError = null;
    try {
      execSync(`cd ${workspaceDir} && node ${path.join(__dirname, '../../dist/index.js')} start --config .workspace-nonexec.yml --force-recreate --no-shell`, {
        stdio: 'pipe',
      });
    } catch (err) {
      nonexecError = err;
    }
    expect(nonexecError).not.toBeNull();
  });
});
