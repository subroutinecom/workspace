const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const fsExtra = require("fs-extra");

const runCommand = (command, args = [], options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        const error = new Error(`Command failed: ${command} ${args.join(" ")}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });

const runCommandStreaming = (command, args = [], options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: "inherit",
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed: ${command} ${args.join(" ")}`));
      }
    });
  });

const ensureDir = async (dirPath) => fsExtra.mkdirp(dirPath);

const writeJson = async (filePath, data) => {
  await ensureDir(path.dirname(filePath));
  await fsExtra.writeJson(filePath, data, { spaces: 2 });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getListeningPorts = async () => {
  try {
    const { stdout } = await runCommand("ss", ["-tlnH"]);
    const ports = new Set();

    for (const line of stdout.split("\n")) {
      const match = line.match(/:(\d+)\s/);
      if (match) {
        ports.add(parseInt(match[1], 10));
      }
    }

    return ports;
  } catch (err) {
    return new Set();
  }
};

module.exports = {
  runCommand,
  runCommandStreaming,
  ensureDir,
  writeJson,
  sleep,
  getListeningPorts,
};
