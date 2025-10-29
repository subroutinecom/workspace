const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  createTestWorkspace,
  execInWorkspace,
  fileExistsInWorkspace,
  startWorkspace,
  cleanupTestWorkspace,
} = require("../helpers/workspace-utils");

const TEST_WORKSPACE_NAME = "test-mounts";

describe("Workspace Mounts", () => {
  let testHostDir;
  let readonlyHostDir;

  before(async () => {
    console.log("\n🧹 Cleaning up any existing test workspace...");
    await cleanupTestWorkspace(TEST_WORKSPACE_NAME);

    // Create test directories on host
    testHostDir = path.join(os.tmpdir(), "workspace-test-mount-rw");
    readonlyHostDir = path.join(os.tmpdir(), "workspace-test-mount-ro");

    if (!fs.existsSync(testHostDir)) {
      fs.mkdirSync(testHostDir, { recursive: true });
    }
    if (!fs.existsSync(readonlyHostDir)) {
      fs.mkdirSync(readonlyHostDir, { recursive: true });
    }

    // Create test files
    fs.writeFileSync(
      path.join(testHostDir, "test-rw.txt"),
      "read-write test file"
    );
    fs.writeFileSync(
      path.join(readonlyHostDir, "test-ro.txt"),
      "read-only test file"
    );

    // Make directories accessible
    fs.chmodSync(testHostDir, 0o777);
    fs.chmodSync(readonlyHostDir, 0o777);

    console.log("📝 Creating test workspace with mounts...");
    await createTestWorkspace(
      TEST_WORKSPACE_NAME,
      {
        mounts: [
          `${testHostDir}:/workspace/test-rw:rw`,
          `${readonlyHostDir}:/workspace/test-ro:ro`,
        ],
      },
      {}
    );

    console.log("🚀 Starting workspace...");
    startWorkspace(TEST_WORKSPACE_NAME);
  });

  after(async () => {
    console.log("\n🧹 Cleaning up test workspace...");
    await cleanupTestWorkspace(TEST_WORKSPACE_NAME);

    // Clean up test directories
    if (fs.existsSync(testHostDir)) {
      fs.rmSync(testHostDir, { recursive: true, force: true });
    }
    if (fs.existsSync(readonlyHostDir)) {
      fs.rmSync(readonlyHostDir, { recursive: true, force: true });
    }
  });

  it("should mount read-write directory", async () => {
    console.log("\n  ✓ Testing read-write mount...");

    // Check if directory is mounted
    const dirExists = fileExistsInWorkspace(
      TEST_WORKSPACE_NAME,
      "/workspace/test-rw"
    );
    assert.ok(dirExists, "Mounted directory should exist");

    // Check if file from host is readable
    const fileContent = execInWorkspace(
      TEST_WORKSPACE_NAME,
      "cat /workspace/test-rw/test-rw.txt"
    );
    assert.strictEqual(
      fileContent.trim(),
      "read-write test file",
      "Should be able to read file from host"
    );

    console.log("    → Read-write mount accessible ✓");
  });

  it("should allow writes to read-write mount", async () => {
    console.log("  ✓ Testing read-write permissions...");

    // Write a file from container (wrap in sh -c to handle redirection in container)
    execInWorkspace(
      TEST_WORKSPACE_NAME,
      "sh -c \"echo 'written from container' > /workspace/test-rw/new-file.txt\""
    );

    // Check if file exists in container
    const containerFile = execInWorkspace(
      TEST_WORKSPACE_NAME,
      "cat /workspace/test-rw/new-file.txt"
    );
    assert.strictEqual(
      containerFile.trim(),
      "written from container",
      "Should be able to write to rw mount"
    );

    // Check if file exists on host
    const hostFilePath = path.join(testHostDir, "new-file.txt");
    assert.ok(
      fs.existsSync(hostFilePath),
      "Written file should appear on host"
    );

    const hostFileContent = fs.readFileSync(hostFilePath, "utf8");
    assert.strictEqual(
      hostFileContent.trim(),
      "written from container",
      "Host file content should match"
    );

    console.log("    → Write permissions working ✓");
    console.log("    → File visible on host ✓");
  });

  it("should mount read-only directory", async () => {
    console.log("  ✓ Testing read-only mount...");

    // Check if directory is mounted
    const dirExists = fileExistsInWorkspace(
      TEST_WORKSPACE_NAME,
      "/workspace/test-ro"
    );
    assert.ok(dirExists, "Read-only directory should exist");

    // Check if file from host is readable
    const fileContent = execInWorkspace(
      TEST_WORKSPACE_NAME,
      "cat /workspace/test-ro/test-ro.txt"
    );
    assert.strictEqual(
      fileContent.trim(),
      "read-only test file",
      "Should be able to read file from ro mount"
    );

    console.log("    → Read-only mount accessible ✓");
  });

  it("should prevent writes to read-only mount", async () => {
    console.log("  ✓ Testing read-only restrictions...");

    // Try to write to read-only mount (should fail) - wrap in sh -c to handle redirection in container
    try {
      execInWorkspace(
        TEST_WORKSPACE_NAME,
        "sh -c \"echo 'should fail' > /workspace/test-ro/fail.txt\""
      );
      assert.fail("Writing to read-only mount should have failed");
    } catch (error) {
      assert.ok(
        error.message.includes("read-only file system") ||
          error.message.includes("Read-only file system"),
        "Error should indicate read-only file system"
      );
    }

    console.log("    → Write restrictions enforced ✓");
  });
});
