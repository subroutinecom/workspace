const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const {
  createTestWorkspace,
  execInWorkspace,
  fileExistsInWorkspace,
  startWorkspace,
  cleanupTestWorkspace,
} = require("../helpers/workspace-utils");

const TEST_WORKSPACE_NAME = "test-env-validation";

describe("Workspace Environment", () => {
  before(async () => {
    console.log("\n🧹 Cleaning up any existing test workspace...");
    await cleanupTestWorkspace(TEST_WORKSPACE_NAME);

    console.log("📝 Creating test workspace...");
    await createTestWorkspace(TEST_WORKSPACE_NAME, {}, {});

    console.log("🚀 Starting workspace...");
    startWorkspace(TEST_WORKSPACE_NAME);
  });

  after(async () => {
    console.log("\n🧹 Cleaning up test workspace...");
    await cleanupTestWorkspace(TEST_WORKSPACE_NAME);
  });

  it("should have Neovim installed with correct version", async () => {
    console.log("\n  ✓ Checking Neovim installation...");

    // Check nvim is available
    const nvimVersion = execInWorkspace(
      TEST_WORKSPACE_NAME,
      "nvim --version"
    );
    assert.ok(nvimVersion.includes("NVIM"), "Neovim should be installed");

    // Extract version number (e.g., "NVIM v0.11.4" -> "0.11.4")
    const versionMatch = nvimVersion.match(/NVIM v(\d+\.\d+\.\d+)/);
    assert.ok(versionMatch, "Should be able to parse Neovim version");

    const version = versionMatch[1];
    const [major, minor] = version.split(".").map(Number);

    // LazyVim requires Neovim >= 0.9.0
    assert.ok(
      major > 0 || (major === 0 && minor >= 9),
      `Neovim version should be >= 0.9.0 (got ${version})`
    );

    console.log(`    → Neovim v${version} installed ✓`);
  });

  it("should have LazyVim configured", async () => {
    console.log("  ✓ Checking LazyVim configuration...");

    // Check LazyVim config exists
    const hasConfig = fileExistsInWorkspace(
      TEST_WORKSPACE_NAME,
      "/home/workspace/.config/nvim/init.lua"
    );
    assert.ok(hasConfig, "LazyVim config should exist");

    // Check config directory structure
    const hasLuaConfig = fileExistsInWorkspace(
      TEST_WORKSPACE_NAME,
      "/home/workspace/.config/nvim/lua/config/lazy.lua"
    );
    assert.ok(hasLuaConfig, "LazyVim lua config should exist");

    // Check plugins directory exists
    const hasPluginsDir = execInWorkspace(
      TEST_WORKSPACE_NAME,
      "test -d /home/workspace/.config/nvim/lua/plugins && echo 'exists' || echo 'missing'"
    );
    assert.ok(
      hasPluginsDir.includes("exists"),
      "Plugins directory should exist"
    );

    console.log("    → LazyVim configured ✓");
    console.log("    → Note: Plugins install on first 'nvim' launch");
  });

  it("should have ripgrep installed", async () => {
    console.log("  ✓ Checking ripgrep (rg)...");

    const rgVersion = execInWorkspace(TEST_WORKSPACE_NAME, "rg --version");
    assert.ok(rgVersion.includes("ripgrep"), "ripgrep should be installed");

    const versionMatch = rgVersion.match(/ripgrep (\d+\.\d+\.\d+)/);
    assert.ok(versionMatch, "Should be able to parse ripgrep version");

    console.log(`    → ripgrep v${versionMatch[1]} installed ✓`);
  });

  it("should have fd (file finder) installed", async () => {
    console.log("  ✓ Checking fd...");

    const fdVersion = execInWorkspace(TEST_WORKSPACE_NAME, "fdfind --version");
    assert.ok(fdVersion.includes("fdfind") || fdVersion.includes("fd"), "fd should be installed");

    const versionMatch = fdVersion.match(/fdfind (\d+\.\d+\.\d+)/) || fdVersion.match(/fd (\d+\.\d+\.\d+)/);
    assert.ok(versionMatch, "Should be able to parse fd version");

    console.log(`    → fd v${versionMatch[1]} installed ✓`);
  });

  it("should have Git installed", async () => {
    console.log("  ✓ Checking Git...");

    const gitVersion = execInWorkspace(TEST_WORKSPACE_NAME, "git --version");
    assert.ok(gitVersion.includes("git version"), "Git should be installed");

    const versionMatch = gitVersion.match(/git version (\d+\.\d+\.\d+)/);
    assert.ok(versionMatch, "Should be able to parse Git version");

    console.log(`    → Git v${versionMatch[1]} installed ✓`);
  });

  it("should have Node.js and npm installed", async () => {
    console.log("  ✓ Checking Node.js and npm...");

    const nodeVersion = execInWorkspace(TEST_WORKSPACE_NAME, "node --version");
    assert.ok(nodeVersion.startsWith("v"), "Node.js should be installed");

    const npmVersion = execInWorkspace(TEST_WORKSPACE_NAME, "npm --version");
    assert.ok(/^\d+\.\d+\.\d+/.test(npmVersion), "npm should be installed");

    console.log(`    → Node.js ${nodeVersion.trim()} installed ✓`);
    console.log(`    → npm v${npmVersion.trim()} installed ✓`);
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

    // Wait for Docker daemon to be ready (it starts in the background)
    let dockerReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        const dockerInfo = execInWorkspace(TEST_WORKSPACE_NAME, "docker info");
        if (dockerInfo.includes("Server Version")) {
          dockerReady = true;
          break;
        }
      } catch {
        // Docker daemon not ready yet, wait
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    assert.ok(dockerReady, "Docker daemon should be running");

    console.log("    → Docker-in-Docker working ✓");
  });

  it("should have Python installed", async () => {
    console.log("  ✓ Checking Python...");

    const pythonVersion = execInWorkspace(
      TEST_WORKSPACE_NAME,
      "python3 --version"
    );
    assert.ok(
      pythonVersion.includes("Python"),
      "Python 3 should be installed"
    );

    const versionMatch = pythonVersion.match(/Python (\d+\.\d+\.\d+)/);
    assert.ok(versionMatch, "Should be able to parse Python version");

    console.log(`    → Python ${versionMatch[1]} installed ✓`);
  });

  it("should have GitHub CLI (gh) installed", async () => {
    console.log("  ✓ Checking GitHub CLI (gh)...");

    const ghVersion = execInWorkspace(TEST_WORKSPACE_NAME, "gh --version");
    assert.ok(ghVersion.includes("gh version"), "GitHub CLI should be installed");

    const versionMatch = ghVersion.match(/gh version (\d+\.\d+\.\d+)/);
    assert.ok(versionMatch, "Should be able to parse gh version");

    console.log(`    → GitHub CLI v${versionMatch[1]} installed ✓`);
  });

  it("should have opencode CLI installed", async () => {
    console.log("  ✓ Checking opencode CLI...");

    const opencodeVersion = execInWorkspace(TEST_WORKSPACE_NAME, "opencode --version");
    assert.ok(opencodeVersion.length > 0, "opencode CLI should be installed");

    // opencode outputs version info
    const versionMatch = opencodeVersion.match(/opencode (\d+\.\d+\.\d+)/i) ||
                         opencodeVersion.match(/(\d+\.\d+\.\d+)/);

    if (versionMatch) {
      console.log(`    → opencode v${versionMatch[1]} installed ✓`);
    } else {
      console.log(`    → opencode installed ✓`);
    }
  });

  it("should have essential development tools", async () => {
    console.log("  ✓ Checking essential dev tools...");

    const tools = [
      { cmd: "curl --version", check: "curl" },
      { cmd: "wget --version", check: "GNU Wget" },
      { cmd: "jq --version", check: "jq-" },
      { cmd: "rsync --version", check: "rsync" },
      { cmd: "unzip -v", check: "UnZip" },
      { cmd: "which vim", check: "/usr/bin/vim" },
      { cmd: "which nano", check: "/usr/bin/nano" },
    ];

    for (const tool of tools) {
      const output = execInWorkspace(TEST_WORKSPACE_NAME, tool.cmd);
      assert.ok(
        output.includes(tool.check),
        `${tool.check} should be installed`
      );
    }

    console.log("    → All essential tools present ✓");
  });

  it("should have workspace user with proper permissions", async () => {
    console.log("  ✓ Checking workspace user...");

    // Check current user
    const whoami = execInWorkspace(TEST_WORKSPACE_NAME, "whoami");
    assert.strictEqual(
      whoami.trim(),
      "workspace",
      "Commands should run as workspace user"
    );

    // Check sudo access
    const sudoTest = execInWorkspace(
      TEST_WORKSPACE_NAME,
      "sudo -n whoami"
    );
    assert.strictEqual(
      sudoTest.trim(),
      "root",
      "workspace user should have passwordless sudo"
    );

    // Check docker group membership
    const groups = execInWorkspace(TEST_WORKSPACE_NAME, "groups");
    assert.ok(
      groups.includes("docker"),
      "workspace user should be in docker group"
    );

    console.log("    → User permissions configured correctly ✓");
  });

  it("should have home directory with proper structure", async () => {
    console.log("  ✓ Checking home directory structure...");

    // Check home directory exists and is owned by workspace user
    const lsHome = execInWorkspace(TEST_WORKSPACE_NAME, "ls -la /home/");
    assert.ok(
      lsHome.includes("workspace workspace"),
      "Home directory should be owned by workspace user"
    );

    // Check .config directory exists
    const hasConfig = fileExistsInWorkspace(
      TEST_WORKSPACE_NAME,
      "/home/workspace/.config/nvim/init.lua"
    );
    assert.ok(hasConfig, ".config/nvim should exist");

    // Check .bashrc exists
    const hasBashrc = fileExistsInWorkspace(
      TEST_WORKSPACE_NAME,
      "/home/workspace/.bashrc"
    );
    assert.ok(hasBashrc, ".bashrc should exist");

    console.log("    → Home directory structure correct ✓");
  });
});
