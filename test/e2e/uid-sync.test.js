import { describe, expect } from 'vitest';
import { test } from '../fixtures/workspace.js';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';

describe('UID/GID Synchronization E2E', () => {
  test('workspace user syncs with host UID/GID', async ({ workspace }) => {
    await workspace.create({});
    await workspace.start();

    const hostUid = process.getuid();
    const hostGid = process.getgid();

    const workspaceUid = workspace.exec('id -u workspace').trim();
    const workspaceGid = workspace.exec('id -g workspace').trim();

    expect(parseInt(workspaceUid)).toBe(hostUid);
    expect(parseInt(workspaceGid)).toBe(hostGid);
  });

  test('mounted credentials from host are readable', async ({ workspace }) => {
    const testCredsDir = path.join(os.homedir(), '.test-workspace-creds');
    const testCredsFile = path.join(testCredsDir, 'test-secret.txt');

    await fs.ensureDir(testCredsDir);
    await fs.writeFile(testCredsFile, 'secret-content', { mode: 0o600 });

    try {
      await workspace.create({
        mounts: [`${testCredsDir}:/home/workspace/.test-creds:ro`]
      });
      await workspace.start();

      const content = workspace.exec('cat /home/workspace/.test-creds/test-secret.txt').trim();
      expect(content).toBe('secret-content');

      const canRead = workspace.exec('test -r /home/workspace/.test-creds/test-secret.txt && echo "yes" || echo "no"').trim();
      expect(canRead).toBe('yes');
    } finally {
      await fs.remove(testCredsDir);
    }
  });

  test('files copied from /host/home are owned by workspace user', async ({ workspace }) => {
    await workspace.create({});
    await workspace.start();

    workspace.exec('cp /host/home/.bashrc /home/workspace/.bashrc-copy');

    const owner = workspace.exec('stat -c "%U" /home/workspace/.bashrc-copy').trim();
    expect(owner).toBe('workspace');

    const uid = workspace.exec('stat -c "%u" /home/workspace/.bashrc-copy').trim();
    const hostUid = process.getuid();
    expect(parseInt(uid)).toBe(hostUid);
  });

  test('bootstrap scripts can copy files without sudo', async ({ workspace }) => {
    const scripts = {
      'copy-from-host.sh': `#!/bin/bash
set -e
cp /host/home/.bashrc /home/workspace/copied.bashrc
echo "owner=$(stat -c "%U" /home/workspace/copied.bashrc)" > /home/workspace/copy-test.txt
echo "uid=$(stat -c "%u" /home/workspace/copied.bashrc)" >> /home/workspace/copy-test.txt
`
    };

    await workspace.create({}, scripts);
    await workspace.start({ forceRecreate: true });

    const copyTest = workspace.readFile('/home/workspace/copy-test.txt');
    expect(copyTest).toContain('owner=workspace');
    expect(copyTest).toContain(`uid=${process.getuid()}`);

    const copied = workspace.fileExists('/home/workspace/copied.bashrc');
    expect(copied).toBe(true);
  });

  test('uid sync persists across container restarts', async ({ workspace }) => {
    await workspace.create({});
    await workspace.start();

    const hostUid = process.getuid();
    const firstUid = workspace.exec('id -u workspace').trim();
    expect(parseInt(firstUid)).toBe(hostUid);

    await workspace.stop();
    await workspace.start();

    const secondUid = workspace.exec('id -u workspace').trim();
    expect(parseInt(secondUid)).toBe(hostUid);
  });

  test('writable credential mounts work correctly', async ({ workspace }) => {
    const testCredsDir = path.join(os.homedir(), '.test-workspace-creds-rw');
    const testCredsFile = path.join(testCredsDir, 'writable.txt');

    await fs.ensureDir(testCredsDir);
    await fs.writeFile(testCredsFile, 'initial', { mode: 0o600 });

    try {
      await workspace.create({
        mounts: [`${testCredsDir}:/home/workspace/.test-creds-rw:rw`]
      });
      await workspace.start();

      workspace.exec('bash -c "echo modified > /home/workspace/.test-creds-rw/writable.txt"');

      const hostContent = await fs.readFile(testCredsFile, 'utf8');
      expect(hostContent.trim()).toBe('modified');
    } finally {
      await fs.remove(testCredsDir);
    }
  });
});
