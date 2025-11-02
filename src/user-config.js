#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const yaml = require("yaml");

const USER_CONFIG_PATH = path.join(os.homedir(), ".workspaces", "config.yml");

function getUserConfig() {
  if (!fs.existsSync(USER_CONFIG_PATH)) {
    return { ssh: {} };
  }

  try {
    const content = fs.readFileSync(USER_CONFIG_PATH, "utf-8");
    const config = yaml.parse(content) || {};
    return validateUserConfig(config);
  } catch (err) {
    console.warn(`Warning: Failed to parse user config at ${USER_CONFIG_PATH}: ${err.message}`);
    return { ssh: {} };
  }
}

function validateUserConfig(config) {
  const validated = { ssh: {} };

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
}

function resolveKeyPath(keyPath) {
  if (keyPath.startsWith("~/")) {
    return path.join(os.homedir(), keyPath.slice(2));
  }
  return path.resolve(keyPath);
}

module.exports = {
  getUserConfig,
};
