import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export async function setup() {
  console.log('\n🏗️  Building workspace Docker image once for all tests...\n');
  try {
    const workspacePath = path.join(PROJECT_ROOT, 'workspace');
    execSync('docker build -t workspace:latest .', {
      cwd: workspacePath,
      stdio: 'inherit',
    });
    console.log('\n✅ Workspace Docker image built successfully\n');
  } catch (error) {
    console.error('\n❌ Failed to build workspace Docker image\n');
    throw error;
  }
}

export async function teardown() {
  console.log('\n🧹 Test suite completed\n');
}
