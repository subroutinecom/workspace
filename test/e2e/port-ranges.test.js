const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const {
  createTestWorkspace,
  startWorkspace,
  cleanupTestWorkspace,
  execWorkspace,
} = require("../helpers/workspace-utils");

const TEST_WORKSPACE_NAME = "test-port-ranges";

describe("Port Range Configuration", () => {
  before(async () => {
    console.log("\n🧹 Cleaning up any existing test workspace...");
    await cleanupTestWorkspace(TEST_WORKSPACE_NAME);
  });

  after(async () => {
    console.log("\n🧹 Cleaning up test workspace...");
    await cleanupTestWorkspace(TEST_WORKSPACE_NAME);
  });

  it("should expand port ranges in forwards configuration", async () => {
    console.log("\n  ✓ Testing port range expansion...");

    // Create workspace with port ranges
    await createTestWorkspace(
      TEST_WORKSPACE_NAME,
      {
        forwards: [
          3000,           // Single port
          "5000-5003",    // Range notation
          8080,           // Another single port
          "9000-9001",    // Small range
        ],
      },
      {}
    );

    console.log("  ✓ Starting workspace...");
    startWorkspace(TEST_WORKSPACE_NAME);

    // The forwards should be expanded to: 3000, 5000, 5001, 5002, 5003, 8080, 9000, 9001
    const expectedPorts = [3000, 5000, 5001, 5002, 5003, 8080, 9000, 9001];

    // Check the status command to verify ports
    const statusOutput = execWorkspace(`status ${TEST_WORKSPACE_NAME}`);

    console.log("  ✓ Verifying expanded ports...");
    expectedPorts.forEach((port) => {
      assert.ok(
        statusOutput.includes(String(port)),
        `Port ${port} should be in the forwarded ports`
      );
    });

    console.log("  ✓ Verifying total port count...");
    // Count forward lines in status output
    const forwardLines = statusOutput.split("\n").filter((line) =>
      line.includes("Forward")
    );
    assert.strictEqual(
      forwardLines.length,
      expectedPorts.length,
      `Should have ${expectedPorts.length} forwarded ports`
    );

    console.log(`    → Successfully expanded to ${expectedPorts.length} ports ✓`);
    console.log(`    → Ports: ${expectedPorts.join(", ")} ✓`);
  });

  it("should handle mixed port formats", async () => {
    console.log("\n  ✓ Testing mixed port formats...");

    // Clean up previous test
    await cleanupTestWorkspace(TEST_WORKSPACE_NAME);

    await createTestWorkspace(
      TEST_WORKSPACE_NAME + "-mixed",
      {
        forwards: [
          4000,
          "6000-6002",
          7000,
        ],
      },
      {}
    );

    startWorkspace(TEST_WORKSPACE_NAME + "-mixed");
    const statusOutput = execWorkspace(`status ${TEST_WORKSPACE_NAME}-mixed`);

    const expectedPorts = [4000, 6000, 6001, 6002, 7000];
    expectedPorts.forEach((port) => {
      assert.ok(
        statusOutput.includes(String(port)),
        `Port ${port} should be forwarded`
      );
    });

    await cleanupTestWorkspace(TEST_WORKSPACE_NAME + "-mixed");
    console.log("    → Mixed format handling works ✓");
  });

  it("should handle single-port ranges", async () => {
    console.log("\n  ✓ Testing single-port range (e.g., 5000-5000)...");

    await cleanupTestWorkspace(TEST_WORKSPACE_NAME);

    await createTestWorkspace(
      TEST_WORKSPACE_NAME + "-single",
      {
        forwards: [
          "8000-8000", // Range with same start and end
          8001,
        ],
      },
      {}
    );

    startWorkspace(TEST_WORKSPACE_NAME + "-single");
    const statusOutput = execWorkspace(`status ${TEST_WORKSPACE_NAME}-single`);

    assert.ok(statusOutput.includes("8000"), "Port 8000 should be forwarded");
    assert.ok(statusOutput.includes("8001"), "Port 8001 should be forwarded");

    await cleanupTestWorkspace(TEST_WORKSPACE_NAME + "-single");
    console.log("    → Single-port range handling works ✓");
  });
});
