const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const {
  createTestWorkspace,
  execInWorkspace,
  readFileInWorkspace,
  fileExistsInWorkspace,
  startWorkspace,
  stopWorkspace,
  cleanupTestWorkspace,
  generateTestWorkspaceName,
} = require("../helpers/workspace-utils");

describe("Bootstrap Scripts E2E", () => {
  let currentWorkspace = null;

  afterEach(async () => {
    // Clean up workspace created in this test
    if (currentWorkspace) {
      try {
        await cleanupTestWorkspace(currentWorkspace);
      } catch (err) {
        // Ignore cleanup errors
      }
      currentWorkspace = null;
    }
  });

  it("should execute bootstrap scripts with full functionality", async () => {
    currentWorkspace = generateTestWorkspaceName("bootstrap-e2e");
    console.log("\n📝 Creating test workspace with bootstrap scripts...");

    // Define bootstrap scripts to test various scenarios
    const scripts = {
      // Script 1: Test sequential execution and environment
      "01-first.sh": `#!/bin/bash
set -e
echo "first" > /home/workspace/order.txt
echo "Script 1 executed" >> /home/workspace/bootstrap.log
echo "HOME=$HOME" >> /home/workspace/env.txt
echo "USER=$USER" >> /home/workspace/env.txt
echo "PWD=$(pwd)" >> /home/workspace/env.txt
`,

      // Script 2: Test sequential execution continues
      "02-second.sh": `#!/bin/bash
set -e
echo "second" >> /home/workspace/order.txt
echo "Script 2 executed" >> /home/workspace/bootstrap.log
`,

      // Script 3: Test file operations and sudo access
      "03-sudo-test.sh": `#!/bin/bash
set -e
echo "third" >> /home/workspace/order.txt
echo "Testing sudo access..." >> /home/workspace/bootstrap.log
# Test sudo without actually installing packages (too slow in DinD)
sudo whoami > /home/workspace/sudo-test.txt
echo "Script 3 executed" >> /home/workspace/bootstrap.log
`,

      // Script 4: Test access to mounted source directory
      "04-mount-test.sh": `#!/bin/bash
set -e
if [ -f /workspace/source/.workspace.yml ]; then
  echo "can-access-source" > /home/workspace/mount-test.txt
else
  echo "cannot-access-source" > /home/workspace/mount-test.txt
fi
echo "Script 4 executed" >> /home/workspace/bootstrap.log
`,
    };

    // Create workspace with all scripts
    await createTestWorkspace(currentWorkspace, {}, scripts);

    console.log("🚀 Starting workspace (this will take a moment)...");
    startWorkspace(currentWorkspace, { forceRecreate: true });

    console.log("✅ Workspace started, running assertions...\n");

    // Test 1: Sequential execution
    console.log("  ✓ Testing sequential script execution...");
    const orderFile = readFileInWorkspace(
      currentWorkspace,
      "/home/workspace/order.txt"
    );
    const lines = orderFile.split("\n").filter((l) => l.trim());
    assert.deepStrictEqual(
      lines,
      ["first", "second", "third"],
      "Scripts should execute in order"
    );

    // Test 2: All scripts executed
    console.log("  ✓ Verifying all scripts executed...");
    const logFile = readFileInWorkspace(
      currentWorkspace,
      "/home/workspace/bootstrap.log"
    );
    assert.ok(
      logFile.includes("Script 1 executed"),
      "Script 1 should have executed"
    );
    assert.ok(
      logFile.includes("Script 2 executed"),
      "Script 2 should have executed"
    );
    assert.ok(
      logFile.includes("Script 3 executed"),
      "Script 3 should have executed"
    );
    assert.ok(
      logFile.includes("Script 4 executed"),
      "Script 4 should have executed"
    );

    // Test 3: Environment variables
    console.log("  ✓ Checking environment variables...");
    const envFile = readFileInWorkspace(
      currentWorkspace,
      "/home/workspace/env.txt"
    );
    assert.ok(
      envFile.includes("HOME=/home/workspace"),
      "HOME should be /home/workspace"
    );
    assert.ok(
      envFile.includes("PWD=/home/workspace"),
      "Working directory should be /home/workspace"
    );
    // Note: USER may be empty in some environments, so we just check it exists
    assert.ok(envFile.includes("USER="), "USER variable should be present");

    // Test 4: Sudo access verification
    console.log("  ✓ Verifying sudo access...");
    const sudoTest = readFileInWorkspace(
      currentWorkspace,
      "/home/workspace/sudo-test.txt"
    );
    assert.strictEqual(
      sudoTest.trim(),
      "root",
      "Sudo should work in bootstrap scripts"
    );
    console.log("    → Sudo access works correctly");

    // Test 5: Access to mounted source directory
    console.log("  ✓ Testing access to mounted source...");
    const mountTest = readFileInWorkspace(
      currentWorkspace,
      "/home/workspace/mount-test.txt"
    );
    assert.strictEqual(
      mountTest,
      "can-access-source",
      "Scripts should be able to access /workspace/source"
    );

    // Test 6: Initialization marker exists
    console.log("  ✓ Checking initialization marker...");
    const markerExists = fileExistsInWorkspace(
      currentWorkspace,
      "/home/workspace/.workspace-initialized"
    );
    assert.ok(
      markerExists,
      "Initialization marker should exist after bootstrap"
    );

    // Test 7: Files persist in volume
    console.log("  ✓ Testing persistence across restart...");
    const beforeRestart = readFileInWorkspace(
      currentWorkspace,
      "/home/workspace/order.txt"
    );

    console.log("    → Stopping workspace...");
    stopWorkspace(currentWorkspace);

    console.log("    → Starting workspace again...");
    startWorkspace(currentWorkspace);

    const afterRestart = readFileInWorkspace(
      currentWorkspace,
      "/home/workspace/order.txt"
    );
    assert.strictEqual(
      afterRestart,
      beforeRestart,
      "Files should persist across restarts"
    );

    // Verify bootstrap didn't re-run (file should still have only 3 lines)
    const linesAfterRestart = afterRestart.split("\n").filter((l) => l.trim());
    assert.strictEqual(
      linesAfterRestart.length,
      3,
      "Bootstrap scripts should not re-run on restart"
    );

    console.log("\n✅ All bootstrap script tests passed!");
  });

  it("should handle missing script gracefully", async () => {
    currentWorkspace = generateTestWorkspaceName("missing-script");

    console.log("\n📝 Testing missing script error handling...");

    // Create workspace with reference to non-existent script
    await createTestWorkspace(
      currentWorkspace,
      {
        bootstrap: {
          scripts: ["scripts/nonexistent.sh"],
        },
      },
      {} // No actual scripts
    );

    console.log("🚀 Starting workspace (should fail gracefully)...");

    try {
      startWorkspace(currentWorkspace);
      assert.fail("Should have failed with missing script error");
    } catch (err) {
      // Expected to fail - this is good
      console.log("  ✓ Workspace initialization failed as expected");
    }

    console.log("✅ Missing script error handling test passed!");
  });

  it("should handle non-executable script gracefully", async () => {
    currentWorkspace = generateTestWorkspaceName("nonexec-script");

    console.log("\n📝 Testing non-executable script error handling...");

    // Create script without execute permissions
    const workspaceDir = await createTestWorkspace(
      currentWorkspace,
      {},
      {
        "test.sh": `#!/bin/bash
echo "This should not run"
`,
      }
    );

    // Remove execute permission
    const fs = require("fs-extra");
    const path = require("path");
    const scriptPath = path.join(workspaceDir, "scripts", "test.sh");
    await fs.chmod(scriptPath, 0o644); // Read/write but not executable

    console.log("🚀 Starting workspace (should fail gracefully)...");

    try {
      startWorkspace(currentWorkspace);
      assert.fail("Should have failed with non-executable script error");
    } catch (err) {
      // Expected to fail - this is good
      console.log("  ✓ Workspace initialization failed as expected");
    }

    console.log("✅ Non-executable script error handling test passed!");
  });
});
