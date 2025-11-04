import { describe, beforeAll, afterAll, test, expect } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  createTestWorkspace,
  startWorkspace,
  cleanupTestWorkspace,
  execInWorkspace,
  fileExistsInWorkspace,
  generateTestWorkspaceName,
} from "../helpers/workspace-utils.js";

describe.skip("Agent credential mounts", () => {
  let workspaceName;
  let testHome;
  let originalHome;
  let originalUserProfile;

  const codexHostPath = () => path.join(testHome, ".codex", "auth.json");
  const opencodeHostPath = () => path.join(testHome, ".local", "share", "opencode", "auth.json");
  const claudeHostPath = () => path.join(testHome, ".claude", ".credentials.json");

  beforeAll(async () => {
    workspaceName = generateTestWorkspaceName("credentials");
    testHome = path.join(os.tmpdir(), `workspace-test-home-${Date.now()}`);
    fs.mkdirSync(testHome, { recursive: true });

    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = testHome;
    process.env.USERPROFILE = testHome;

    fs.mkdirSync(path.dirname(codexHostPath()), { recursive: true });
    fs.writeFileSync(codexHostPath(), '{"token":"codex"}', "utf8");

    fs.mkdirSync(path.dirname(opencodeHostPath()), { recursive: true });
    fs.writeFileSync(opencodeHostPath(), '{"token":"opencode"}', "utf8");

    fs.mkdirSync(path.dirname(claudeHostPath()), { recursive: true });
    fs.writeFileSync(claudeHostPath(), '{"token":"claude"}', "utf8");

    await createTestWorkspace(
      workspaceName,
      {
        mountAgentsCredentials: true,
      },
      {},
    );
    startWorkspace(workspaceName);
  });

  afterAll(async () => {
    await cleanupTestWorkspace(workspaceName);

    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;

    if (fs.existsSync(testHome)) {
      fs.rmSync(testHome, { recursive: true, force: true });
    }
  });

  test("mounts credential files into workspace", () => {
    const codexPath = "/home/workspace/.codex/auth.json";
    const opencodePath = "/home/workspace/.local/share/opencode/auth.json";
    const claudePath = "/home/workspace/.claude/.credentials.json";

    expect(fileExistsInWorkspace(workspaceName, codexPath)).toBe(true);
    expect(fileExistsInWorkspace(workspaceName, opencodePath)).toBe(true);
    expect(fileExistsInWorkspace(workspaceName, claudePath)).toBe(true);

    const codexContent = execInWorkspace(workspaceName, `cat ${codexPath}`).trim();
    const opencodeContent = execInWorkspace(workspaceName, `cat ${opencodePath}`).trim();
    const claudeContent = execInWorkspace(workspaceName, `cat ${claudePath}`).trim();

    expect(codexContent).toBe('{"token":"codex"}');
    expect(opencodeContent).toBe('{"token":"opencode"}');
    expect(claudeContent).toBe('{"token":"claude"}');
  });
});
