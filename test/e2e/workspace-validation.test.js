const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const {
  createTestWorkspace,
  execInWorkspace,
  fileExistsInWorkspace,
  startWorkspace,
  cleanupTestWorkspace,
  execWorkspace,
} = require("../helpers/workspace-utils");

const TEST_WORKSPACE_NAME = "test-workspace-validation";

describe("Workspace Validation", () => {
  before(async () => {
    console.log("\n🧹 Cleaning up any existing test workspace...");
    await cleanupTestWorkspace(TEST_WORKSPACE_NAME);

    console.log("📝 Creating test workspace...");
    await createTestWorkspace(
      TEST_WORKSPACE_NAME,
      {
        forwards: [
          3000,           // Single port
          "5000-5003",    // Multi-port range
          8080,           // Another single port
          "9000-9001",    // Small range
          "7000-7000",    // Single-port range (edge case)
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
  });

  it("should have Neovim installed with correct version", async () => {
    console.log("\n  ✓ Checking Neovim installation...");

    const nvimVersion = execInWorkspace(
      TEST_WORKSPACE_NAME,
      "nvim --version"
    );
    assert.ok(nvimVersion.includes("NVIM"), "Neovim should be installed");

    const versionMatch = nvimVersion.match(/NVIM v(\d+\.\d+\.\d+)/);
    assert.ok(versionMatch, "Should be able to parse Neovim version");

    const version = versionMatch[1];
    const [major, minor] = version.split(".").map(Number);

    assert.ok(
      major > 0 || (major === 0 && minor >= 9),
      `Neovim version should be >= 0.9.0 (got ${version})`
    );

    console.log(`    → Neovim v${version} installed ✓`);
  });

  it("should have LazyVim configured", async () => {
    console.log("  ✓ Checking LazyVim configuration...");

    const hasConfig = fileExistsInWorkspace(
      TEST_WORKSPACE_NAME,
      "/home/workspace/.config/nvim/init.lua"
    );
    assert.ok(hasConfig, "LazyVim config should exist");

    const hasLuaConfig = fileExistsInWorkspace(
      TEST_WORKSPACE_NAME,
      "/home/workspace/.config/nvim/lua/config/lazy.lua"
    );
    assert.ok(hasLuaConfig, "LazyVim lua config should exist");

    console.log("    → LazyVim configured ✓");
  });

  it("should have required CLI tools installed", async () => {
    console.log("  ✓ Checking CLI tools...");

    const tools = [
      { cmd: "rg --version", check: "ripgrep", name: "ripgrep" },
      { cmd: "fdfind --version", check: "fdfind", name: "fd-find" },
      { cmd: "git --version", check: "git version", name: "Git" },
      { cmd: "node --version", check: "v", name: "Node.js" },
      { cmd: "npm --version", check: /^\d+\.\d+\.\d+/, name: "npm" },
      { cmd: "python3 --version", check: "Python", name: "Python 3" },
      { cmd: "gh --version", check: "gh version", name: "GitHub CLI" },
      { cmd: "opencode --version", check: /\d+\.\d+\.\d+/, name: "opencode" },
    ];

    for (const tool of tools) {
      const output = execInWorkspace(TEST_WORKSPACE_NAME, tool.cmd);
      if (typeof tool.check === "string") {
        assert.ok(output.includes(tool.check), `${tool.name} should be installed`);
      } else {
        assert.ok(tool.check.test(output), `${tool.name} should be installed`);
      }
    }

    console.log("    → All CLI tools present ✓");
  });

  it("should have Docker-in-Docker working", async () => {
    console.log("  ✓ Checking Docker-in-Docker...");

    const dockerVersion = execInWorkspace(
      TEST_WORKSPACE_NAME,
      "docker --version"
    );
    assert.ok(
      dockerVersion.includes("Docker version"),
      "Docker should be installed"
    );

    // Wait for Docker daemon to be ready
    let dockerReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        const dockerInfo = execInWorkspace(TEST_WORKSPACE_NAME, "docker info");
        if (dockerInfo.includes("Server Version")) {
          dockerReady = true;
          break;
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    assert.ok(dockerReady, "Docker daemon should be running");
    console.log("    → Docker-in-Docker working ✓");
  });

  it("should have workspace user with proper permissions", async () => {
    console.log("  ✓ Checking workspace user...");

    const whoami = execInWorkspace(TEST_WORKSPACE_NAME, "whoami");
    assert.strictEqual(
      whoami.trim(),
      "workspace",
      "Commands should run as workspace user"
    );

    const sudoTest = execInWorkspace(
      TEST_WORKSPACE_NAME,
      "sudo -n whoami"
    );
    assert.strictEqual(
      sudoTest.trim(),
      "root",
      "workspace user should have passwordless sudo"
    );

    const groups = execInWorkspace(TEST_WORKSPACE_NAME, "groups");
    assert.ok(
      groups.includes("docker"),
      "workspace user should be in docker group"
    );

    console.log("    → User permissions configured correctly ✓");
  });

  it("should have home directory with proper structure", async () => {
    console.log("  ✓ Checking home directory structure...");

    const hasConfig = fileExistsInWorkspace(
      TEST_WORKSPACE_NAME,
      "/home/workspace/.config/nvim/init.lua"
    );
    assert.ok(hasConfig, ".config/nvim should exist");

    const hasBashrc = fileExistsInWorkspace(
      TEST_WORKSPACE_NAME,
      "/home/workspace/.bashrc"
    );
    assert.ok(hasBashrc, ".bashrc should exist");

    console.log("    → Home directory structure correct ✓");
  });

  it("should expand port ranges correctly", async () => {
    console.log("  ✓ Verifying port range expansion...");

    const expectedPorts = [3000, 5000, 5001, 5002, 5003, 8080, 9000, 9001, 7000];
    const statusOutput = execWorkspace(`status ${TEST_WORKSPACE_NAME}`);

    console.log("  ✓ Verifying all expanded ports are present...");
    expectedPorts.forEach((port) => {
      assert.ok(
        statusOutput.includes(String(port)),
        `Port ${port} should be in the forwarded ports`
      );
    });

    const forwardLines = statusOutput.split("\n").filter((line) =>
      line.includes("Forward")
    );
    assert.strictEqual(
      forwardLines.length,
      expectedPorts.length,
      `Should have ${expectedPorts.length} forwarded ports`
    );

    console.log(`    → Successfully expanded to ${expectedPorts.length} ports ✓`);
    console.log(`    → Individual ports: 3000, 8080 ✓`);
    console.log(`    → Multi-port range (5000-5003): 5000, 5001, 5002, 5003 ✓`);
    console.log(`    → Small range (9000-9001): 9000, 9001 ✓`);
    console.log(`    → Single-port range (7000-7000): 7000 ✓`);
  });
});
