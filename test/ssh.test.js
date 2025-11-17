import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(__dirname, "..");
const distModule = path.join(projectRoot, "dist/ssh.js");
const srcModule = path.join(projectRoot, "src/ssh.js");
const modulePath = fs.existsSync(distModule) ? distModule : srcModule;
const { matchRepoToKey, selectKeyForRepo, selectDefaultKey } = require(modulePath);

describe("SSH Key Selection", () => {
  describe("matchRepoToKey", () => {
    it("should match exact repository URL", () => {
      const userConfig = {
        ssh: {
          repos: {
            "git@github.com:user/repo.git": "/home/user/.ssh/id_github",
          },
        },
      };

      const result = matchRepoToKey("git@github.com:user/repo.git", userConfig);
      expect(result).toBe("/home/user/.ssh/id_github");
    });

    it("should match wildcard pattern", () => {
      const userConfig = {
        ssh: {
          repos: {
            "git@github.com:company/*": "/home/user/.ssh/id_work",
          },
        },
      };

      const result = matchRepoToKey("git@github.com:company/project.git", userConfig);
      expect(result).toBe("/home/user/.ssh/id_work");
    });

    it("should match domain-level wildcard", () => {
      const userConfig = {
        ssh: {
          repos: {
            "git@gitlab.com:*": "/home/user/.ssh/id_gitlab",
          },
        },
      };

      const result = matchRepoToKey("git@gitlab.com:user/project.git", userConfig);
      expect(result).toBe("/home/user/.ssh/id_gitlab");
    });

    it("should return null if no match", () => {
      const userConfig = {
        ssh: {
          repos: {
            "git@github.com:company/*": "/home/user/.ssh/id_work",
          },
        },
      };

      const result = matchRepoToKey("git@gitlab.com:user/repo.git", userConfig);
      expect(result).toBeNull();
    });

    it("should return null if no repos configured", () => {
      const userConfig = { ssh: {} };
      const result = matchRepoToKey("git@github.com:user/repo.git", userConfig);
      expect(result).toBeNull();
    });

    it("should prefer exact match over pattern match", () => {
      const userConfig = {
        ssh: {
          repos: {
            "git@github.com:company/*": "/home/user/.ssh/id_work",
            "git@github.com:company/special.git": "/home/user/.ssh/id_special",
          },
        },
      };

      const result = matchRepoToKey("git@github.com:company/special.git", userConfig);
      expect(result).toBe("/home/user/.ssh/id_special");
    });

    it("should handle HTTPS URLs", () => {
      const userConfig = {
        ssh: {
          repos: {
            "https://github.com/company/*": "/home/user/.ssh/id_work",
          },
        },
      };

      const result = matchRepoToKey("https://github.com/company/project.git", userConfig);
      expect(result).toBe("/home/user/.ssh/id_work");
    });
  });

  describe("selectDefaultKey", () => {
    it("should return configured defaultKey if exists", () => {
      const userConfig = {
        ssh: {
          defaultKey: "/home/user/.ssh/id_ed25519",
        },
      };

      const result = selectDefaultKey(userConfig);
      expect(result).toBe("/home/user/.ssh/id_ed25519");
    });

    it("should use heuristic if no defaultKey configured", () => {
      const userConfig = { ssh: {} };
      const result = selectDefaultKey(userConfig);
      if (result) {
        expect(typeof result).toBe("string");
      } else {
        expect(result).toBeNull();
      }
    });
  });

  describe("selectKeyForRepo", () => {
    it("should use repo-specific key if configured", () => {
      const userConfig = {
        ssh: {
          defaultKey: "/home/user/.ssh/id_ed25519",
          repos: {
            "git@github.com:company/*": "/home/user/.ssh/id_work",
          },
        },
      };

      const result = selectKeyForRepo("git@github.com:company/project.git", userConfig);
      expect(result).toBe("/home/user/.ssh/id_work");
    });

    it("should fall back to default key if no repo match", () => {
      const userConfig = {
        ssh: {
          defaultKey: "/home/user/.ssh/id_ed25519",
          repos: {
            "git@gitlab.com:*": "/home/user/.ssh/id_gitlab",
          },
        },
      };

      const result = selectKeyForRepo("git@github.com:user/repo.git", userConfig);
      expect(result).toBe("/home/user/.ssh/id_ed25519");
    });

    it("should use heuristic if no config", () => {
      const userConfig = { ssh: {} };
      const result = selectKeyForRepo("git@github.com:user/repo.git", userConfig);
      if (result) {
        expect(typeof result).toBe("string");
      } else {
        expect(result).toBeNull();
      }
    });
  });
});
