const { describe, it, before, after, afterEach } = require("node:test");
const assert = require("node:assert");
const {
  createTestWorkspace,
  execInWorkspace,
  fileExistsInWorkspace,
  startWorkspace,
  cleanupTestWorkspace,
  execWorkspace,
  generateTestWorkspaceName,
} = require("../helpers/workspace-utils");

describe("Workspace Validation", () => {
  let currentWorkspace = null;

  before(async () => {
    currentWorkspace = generateTestWorkspaceName("workspace-validation");

    console.log("\n📝 Creating test workspace...");
    await createTestWorkspace(
      currentWorkspace,
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
    startWorkspace(currentWorkspace);
  });

  after(async () => {
    console.log("\n🧹 Cleaning up test workspace...");
    if (currentWorkspace) {
      await cleanupTestWorkspace(currentWorkspace);
    }
  });

  it("should have Neovim installed with correct version", async () => {
    console.log("\n  ✓ Checking Neovim installation...");

    const nvimVersion = execInWorkspace(
      currentWorkspace,
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
      currentWorkspace,
      "/home/workspace/.config/nvim/init.lua"
    );
    assert.ok(hasConfig, "LazyVim config should exist");

    const hasLuaConfig = fileExistsInWorkspace(
      currentWorkspace,
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
      const output = execInWorkspace(currentWorkspace, tool.cmd);
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
      currentWorkspace,
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
        const dockerInfo = execInWorkspace(currentWorkspace, "docker info");
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

    const whoami = execInWorkspace(currentWorkspace, "whoami");
    assert.strictEqual(
      whoami.trim(),
      "workspace",
      "Commands should run as workspace user"
    );

    const sudoTest = execInWorkspace(
      currentWorkspace,
      "sudo -n whoami"
    );
    assert.strictEqual(
      sudoTest.trim(),
      "root",
      "workspace user should have passwordless sudo"
    );

    const groups = execInWorkspace(currentWorkspace, "groups");
    assert.ok(
      groups.includes("docker"),
      "workspace user should be in docker group"
    );

    console.log("    → User permissions configured correctly ✓");
  });

  it("should have home directory with proper structure", async () => {
    console.log("  ✓ Checking home directory structure...");

    const hasConfig = fileExistsInWorkspace(
      currentWorkspace,
      "/home/workspace/.config/nvim/init.lua"
    );
    assert.ok(hasConfig, ".config/nvim should exist");

    const hasBashrc = fileExistsInWorkspace(
      currentWorkspace,
      "/home/workspace/.bashrc"
    );
    assert.ok(hasBashrc, ".bashrc should exist");

    console.log("    → Home directory structure correct ✓");
  });

  it("should expand port ranges correctly", async () => {
    console.log("  ✓ Verifying port range expansion...");

    const expectedPorts = [3000, 5000, 5001, 5002, 5003, 8080, 9000, 9001, 7000];
    const path = require("path");
    const workspacePath = path.join(__dirname, "../../packages", currentWorkspace);
    const statusOutput = execWorkspace(`status ${currentWorkspace} --path ${workspacePath}`);

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
