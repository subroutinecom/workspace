import { describe, expect, beforeAll, afterAll } from 'vitest';
import { test } from '../fixtures/workspace.js';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import {
  createTestWorkspace,
  startWorkspace,
  cleanupTestWorkspace,
  execInWorkspace,
  fileExistsInWorkspace,
  readFileInWorkspace,
  stopWorkspace,
  generateTestWorkspaceName,
} from '../helpers/workspace-utils.js';

describe('UID/GID Synchronization E2E', () => {
  let workspaceName;
  let testCredsDir;
  let testCredsFile;
  let testCredsRwDir;
  let testCredsRwFile;

  beforeAll(async () => {
    workspaceName = generateTestWorkspaceName('uid-sync');

    testCredsDir = path.join(os.homedir(), '.test-workspace-creds');
    testCredsFile = path.join(testCredsDir, 'test-secret.txt');
    testCredsRwDir = path.join(os.homedir(), '.test-workspace-creds-rw');
    testCredsRwFile = path.join(testCredsRwDir, 'writable.txt');

    await fs.ensureDir(testCredsDir);
    await fs.writeFile(testCredsFile, 'secret-content', { mode: 0o600 });
    await fs.ensureDir(testCredsRwDir);
    await fs.writeFile(testCredsRwFile, 'initial', { mode: 0o600 });

    const scripts = {
      'copy-from-host.sh': `#!/bin/bash
set -e
cp /host/home/.bashrc /home/workspace/copied.bashrc
echo "owner=$(stat -c "%U" /home/workspace/copied.bashrc)" > /home/workspace/copy-test.txt
echo "uid=$(stat -c "%u" /home/workspace/copied.bashrc)" >> /home/workspace/copy-test.txt
`
    };

    await createTestWorkspace(
      workspaceName,
      {
        mounts: [
          `${testCredsDir}:/home/workspace/.test-creds:ro`,
          `${testCredsRwDir}:/home/workspace/.test-creds-rw:rw`
        ]
      },
      scripts
    );
    startWorkspace(workspaceName);
  });

  afterAll(async () => {
    await cleanupTestWorkspace(workspaceName);
    await fs.remove(testCredsDir);
    await fs.remove(testCredsRwDir);
  });

  test('uid/gid sync, file ownership, restart, mounts, and bootstrap', () => {
    const hostUid = process.getuid();
    const hostGid = process.getgid();

    const workspaceUid = execInWorkspace(workspaceName, 'id -u workspace').trim();
    const workspaceGid = execInWorkspace(workspaceName, 'id -g workspace').trim();

    expect(parseInt(workspaceUid)).toBe(hostUid);
    expect(parseInt(workspaceGid)).toBe(hostGid);

    execInWorkspace(workspaceName, 'cp /host/home/.bashrc /home/workspace/.bashrc-copy');

    const owner = execInWorkspace(workspaceName, 'stat -c "%U" /home/workspace/.bashrc-copy').trim();
    expect(owner).toBe('workspace');

    const uid = execInWorkspace(workspaceName, 'stat -c "%u" /home/workspace/.bashrc-copy').trim();
    expect(parseInt(uid)).toBe(hostUid);

    const content = execInWorkspace(workspaceName, 'cat /home/workspace/.test-creds/test-secret.txt').trim();
    expect(content).toBe('secret-content');

    const canRead = execInWorkspace(workspaceName, 'test -r /home/workspace/.test-creds/test-secret.txt && echo "yes" || echo "no"').trim();
    expect(canRead).toBe('yes');

    execInWorkspace(workspaceName, 'bash -c "echo modified > /home/workspace/.test-creds-rw/writable.txt"');

    const hostContent = fs.readFileSync(testCredsRwFile, 'utf8');
    expect(hostContent.trim()).toBe('modified');

    const copyTest = readFileInWorkspace(workspaceName, '/home/workspace/copy-test.txt');
    expect(copyTest).toContain('owner=workspace');
    expect(copyTest).toContain(`uid=${process.getuid()}`);

    const copied = fileExistsInWorkspace(workspaceName, '/home/workspace/copied.bashrc');
    expect(copied).toBe(true);

    stopWorkspace(workspaceName);
    startWorkspace(workspaceName);

    const secondUid = execInWorkspace(workspaceName, 'id -u workspace').trim();
    expect(parseInt(secondUid)).toBe(hostUid);
  });
});
