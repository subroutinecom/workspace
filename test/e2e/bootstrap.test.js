import { describe, expect } from 'vitest';
import { test } from '../fixtures/workspace.js';

describe('Bootstrap Scripts E2E', () => {
  test('should execute bootstrap scripts with full functionality', async ({ workspace }) => {
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

    await workspace.create({}, scripts);
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
  });

  test('should handle missing script gracefully', async ({ workspace }) => {
    await workspace.create(
      {
        bootstrap: {
          scripts: ['scripts/nonexistent.sh'],
        },
      },
      {}
    );

    await expect(() => workspace.start()).rejects.toThrow();
  });

  test('should handle non-executable script gracefully', async ({ workspace }) => {
    const fs = await import('fs-extra');
    const path = await import('path');

    const workspaceDir = await workspace.create(
      {},
      {
        'test.sh': `#!/bin/bash
echo "This should not run"
`,
      }
    );

    const scriptPath = path.join(workspaceDir, 'scripts', 'test.sh');
    await fs.chmod(scriptPath, 0o644);

    await expect(() => workspace.start()).rejects.toThrow();
  });
});
