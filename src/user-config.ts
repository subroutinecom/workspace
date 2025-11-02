import fs from "fs";
import path from "path";
import os from "os";
import yaml from "yaml";

const USER_CONFIG_PATH = path.join(os.homedir(), ".workspaces", "config.yml");

interface UserConfig {
  ssh?: {
    defaultKey?: string;
    repos?: Record<string, string>;
  };
}

export interface ValidatedUserConfig {
  ssh: {
    defaultKey?: string;
    repos?: Record<string, string>;
  };
}

const resolveKeyPath = (keyPath: string): string => {
  if (keyPath.startsWith("~/")) {
    return path.join(os.homedir(), keyPath.slice(2));
  }
  return path.resolve(keyPath);
};

const validateUserConfig = (config: UserConfig): ValidatedUserConfig => {
  const validated: ValidatedUserConfig = { ssh: {} };

  if (!config.ssh) {
    return validated;
  }

  if (config.ssh.defaultKey) {
    const keyPath = resolveKeyPath(config.ssh.defaultKey);
    if (!fs.existsSync(keyPath)) {
      console.warn(`Warning: Default SSH key not found: ${config.ssh.defaultKey}`);
    } else {
      validated.ssh.defaultKey = keyPath;
    }
  }

  if (config.ssh.repos && typeof config.ssh.repos === "object") {
    validated.ssh.repos = {};
    for (const [pattern, keyPath] of Object.entries(config.ssh.repos)) {
      const resolved = resolveKeyPath(keyPath);
      if (!fs.existsSync(resolved)) {
        console.warn(`Warning: SSH key not found for pattern "${pattern}": ${keyPath}`);
      } else {
        validated.ssh.repos[pattern] = resolved;
      }
    }
  }

  return validated;
};

export const getUserConfig = (): ValidatedUserConfig => {
  if (!fs.existsSync(USER_CONFIG_PATH)) {
    return { ssh: {} };
  }

  try {
    const content = fs.readFileSync(USER_CONFIG_PATH, "utf-8");
    const config = (yaml.parse(content) as UserConfig | null) || {};
    return validateUserConfig(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Warning: Failed to parse user config at ${USER_CONFIG_PATH}: ${message}`);
    return { ssh: {} };
  }
};
