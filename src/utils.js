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

const expandHome = (inputPath) => {
  if (!inputPath) {
    return inputPath;
  }
  if (inputPath.startsWith("~")) {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return inputPath;
};

const pathExists = async (inputPath) => fsExtra.pathExists(inputPath);

const ensureDir = async (dirPath) => fsExtra.mkdirp(dirPath);

const writeJson = async (filePath, data) => {
  await ensureDir(path.dirname(filePath));
  await fsExtra.writeJson(filePath, data, { spaces: 2 });
};

const readJson = async (filePath, fallback = null) => {
  try {
    return await fsExtra.readJson(filePath);
  } catch (err) {
    if (err.code === "ENOENT") {
      return fallback;
    }
    throw err;
  }
};

const randomPort = (base = 2200) => base + Math.floor(Math.random() * 600);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatCommand = (command, args = []) => [command, ...args].join(" ");

module.exports = {
  runCommand,
  runCommandStreaming,
  expandHome,
  pathExists,
  ensureDir,
  writeJson,
  readJson,
  randomPort,
  sleep,
  formatCommand,
};
