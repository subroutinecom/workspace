#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const SSH_DIR = path.join(os.homedir(), ".ssh");

function discoverSshKeys() {
  if (!fs.existsSync(SSH_DIR)) {
    return [];
  }

  const files = fs.readdirSync(SSH_DIR);
  const keys = [];

  for (const file of files) {
    if (file.endsWith(".pub")) continue;
    if (file === "config" || file === "known_hosts" || file === "authorized_keys") continue;

    const fullPath = path.join(SSH_DIR, file);
    const stat = fs.statSync(fullPath);

    if (!stat.isFile()) continue;

    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      if (content.includes("PRIVATE KEY")) {
        keys.push(fullPath);
      }
    } catch (err) {
      continue;
    }
  }

  return keys;
}

function getKeysFromAgent() {
  const agentSocket = process.env.SSH_AUTH_SOCK;
  if (!agentSocket || !fs.existsSync(agentSocket)) {
    return [];
  }

  const result = spawnSync("ssh-add", ["-L"], { encoding: "utf-8" });
  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  const keys = [];
  const lines = result.stdout.trim().split("\n");

  for (const line of lines) {
    if (line.includes("ssh-rsa") || line.includes("ssh-ed25519") || line.includes("ecdsa-")) {
      const parts = line.trim().split(" ");
      if (parts.length >= 3) {
        const comment = parts.slice(2).join(" ");
        if (comment && !comment.startsWith("The agent has")) {
          keys.push(comment);
        }
      }
    }
  }

  return keys;
}

function selectDefaultKey(userConfig) {
  if (userConfig.ssh?.defaultKey) {
    return userConfig.ssh.defaultKey;
  }

  const agentKeys = getKeysFromAgent();
  if (agentKeys.length > 0) {
    const firstAgentKey = agentKeys[0];
    if (fs.existsSync(firstAgentKey)) {
      return firstAgentKey;
    }
  }

  const standardKeys = [
    path.join(SSH_DIR, "id_ed25519"),
    path.join(SSH_DIR, "id_ecdsa"),
    path.join(SSH_DIR, "id_rsa"),
  ];

  for (const keyPath of standardKeys) {
    if (fs.existsSync(keyPath)) {
      return keyPath;
    }
  }

  const discovered = discoverSshKeys();
  if (discovered.length > 0) {
    return discovered[0];
  }

  return null;
}

function matchRepoToKey(repoUrl, userConfig) {
  if (!repoUrl || !userConfig.ssh?.repos) {
    return null;
  }

  const repos = userConfig.ssh.repos;

  if (repos[repoUrl]) {
    return repos[repoUrl];
  }

  for (const [pattern, keyPath] of Object.entries(repos)) {
    if (matchPattern(repoUrl, pattern)) {
      return keyPath;
    }
  }

  return null;
}

function matchPattern(url, pattern) {
  if (!pattern.includes("*")) {
    return url === pattern;
  }

  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(url);
}

function selectKeyForRepo(repoUrl, userConfig) {
  const repoKey = matchRepoToKey(repoUrl, userConfig);
  if (repoKey) {
    return repoKey;
  }

  return selectDefaultKey(userConfig);
}

function getKeyBasename(keyPath) {
  if (!keyPath) return null;
  return path.basename(keyPath);
}

module.exports = {
  discoverSshKeys,
  getKeysFromAgent,
  selectDefaultKey,
  matchRepoToKey,
  selectKeyForRepo,
  getKeyBasename,
};
