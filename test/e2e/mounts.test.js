import { describe, expect, beforeAll, afterAll } from 'vitest';
import { test } from '../fixtures/workspace.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  createTestWorkspace,
  execInWorkspace,
  fileExistsInWorkspace,
  startWorkspace,
  cleanupTestWorkspace,
  generateTestWorkspaceName,
} from '../helpers/workspace-utils.js';

describe('Workspace Mounts', () => {
  let testHostDir;
  let readonlyHostDir;
  let currentWorkspace = null;

  beforeAll(async () => {
    currentWorkspace = generateTestWorkspaceName('mounts');

    testHostDir = path.join(os.tmpdir(), 'workspace-test-mount-rw');
    readonlyHostDir = path.join(os.tmpdir(), 'workspace-test-mount-ro');

    if (!fs.existsSync(testHostDir)) {
      fs.mkdirSync(testHostDir, { recursive: true });
    }
    if (!fs.existsSync(readonlyHostDir)) {
      fs.mkdirSync(readonlyHostDir, { recursive: true });
    }

    fs.writeFileSync(path.join(testHostDir, 'test-rw.txt'), 'read-write test file');
    fs.writeFileSync(path.join(readonlyHostDir, 'test-ro.txt'), 'read-only test file');

    fs.chmodSync(testHostDir, 0o777);
    fs.chmodSync(readonlyHostDir, 0o777);

    console.log('📝 Creating test workspace with mounts...');
    await createTestWorkspace(
      currentWorkspace,
      {
        mounts: [
          `${testHostDir}:/workspace/test-rw:rw`,
          `${readonlyHostDir}:/workspace/test-ro:ro`,
        ],
      },
      {}
    );

    console.log('🚀 Starting workspace...');
    startWorkspace(currentWorkspace);
  });

  afterAll(async () => {
    console.log('\n🧹 Cleaning up test workspace...');
    await cleanupTestWorkspace(currentWorkspace);

    if (fs.existsSync(testHostDir)) {
      fs.rmSync(testHostDir, { recursive: true, force: true });
    }
    if (fs.existsSync(readonlyHostDir)) {
      fs.rmSync(readonlyHostDir, { recursive: true, force: true });
    }
  });

  test('should mount read-write directory', async () => {
    console.log('\n  ✓ Testing read-write mount...');

    const dirExists = fileExistsInWorkspace(currentWorkspace, '/workspace/test-rw');
    expect(dirExists).toBe(true);

    const fileContent = execInWorkspace(currentWorkspace, 'cat /workspace/test-rw/test-rw.txt');
    expect(fileContent.trim()).toBe('read-write test file');

    console.log('    → Read-write mount accessible ✓');
  });

  test('should allow writes to read-write mount', async () => {
    console.log('  ✓ Testing read-write permissions...');

    execInWorkspace(
      currentWorkspace,
      "sh -c \"echo 'written from container' > /workspace/test-rw/new-file.txt\""
    );

    const containerFile = execInWorkspace(currentWorkspace, 'cat /workspace/test-rw/new-file.txt');
    expect(containerFile.trim()).toBe('written from container');

    const hostFilePath = path.join(testHostDir, 'new-file.txt');
    expect(fs.existsSync(hostFilePath)).toBe(true);

    const hostFileContent = fs.readFileSync(hostFilePath, 'utf8');
    expect(hostFileContent.trim()).toBe('written from container');

    console.log('    → Write permissions working ✓');
    console.log('    → File visible on host ✓');
  });

  test('should mount read-only directory', async () => {
    console.log('  ✓ Testing read-only mount...');

    const dirExists = fileExistsInWorkspace(currentWorkspace, '/workspace/test-ro');
    expect(dirExists).toBe(true);

    const fileContent = execInWorkspace(currentWorkspace, 'cat /workspace/test-ro/test-ro.txt');
    expect(fileContent.trim()).toBe('read-only test file');

    console.log('    → Read-only mount accessible ✓');
  });

  test('should prevent writes to read-only mount', async () => {
    console.log('  ✓ Testing read-only restrictions...');

    try {
      execInWorkspace(
        currentWorkspace,
        "sh -c \"echo 'should fail' > /workspace/test-ro/fail.txt\""
      );
      throw new Error('Writing to read-only mount should have failed');
    } catch (error) {
      expect(
        error.message.includes('read-only file system') ||
          error.message.includes('Read-only file system')
      ).toBe(true);
    }

    console.log('    → Write restrictions enforced ✓');
  });
});
