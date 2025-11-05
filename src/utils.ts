import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import fsExtra from "fs-extra";
import ora from "ora";

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface StreamingCommandOptions extends CommandOptions {
  quiet?: boolean;
}

export interface LoggingCommandOptions extends CommandOptions {
  logFile?: string;
  onOutput?: (data: string) => void;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface CommandError extends Error {
  code?: number;
  stdout?: string;
  stderr?: string;
  logFile?: string;
}

const normalizeEnv = (env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  if (!env) {
    return process.env;
  }
  return { ...process.env, ...env };
};

export const runCommand = (
  command: string,
  args: string[] = [],
  options: CommandOptions = {},
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: normalizeEnv(options.env),
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
        const error: CommandError = new Error(`Command failed: ${command} ${args.join(" ")}`);
        error.code = code ?? undefined;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });

export const runCommandStreaming = (
  command: string,
  args: string[] = [],
  options: StreamingCommandOptions = {},
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: normalizeEnv(options.env),
      stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    });

    let stderr = "";

    if (options.quiet && child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const error: CommandError = new Error(`Command failed: ${command} ${args.join(" ")}`);
        if (options.quiet && stderr) {
          error.stderr = stderr;
        }
        reject(error);
      }
    });
  });

export const runCommandWithLogging = (
  command: string,
  args: string[] = [],
  options: LoggingCommandOptions = {},
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: normalizeEnv(options.env),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const logStream = options.logFile ? fs.createWriteStream(options.logFile, { flags: "a" }) : null;

    child.stdout.on("data", (chunk) => {
      const data = chunk.toString();
      stdout += data;
      if (logStream) logStream.write(data);
      if (options.onOutput) options.onOutput(data);
    });

    child.stderr.on("data", (chunk) => {
      const data = chunk.toString();
      stderr += data;
      if (logStream) logStream.write(data);
      if (options.onOutput) options.onOutput(data);
    });

    child.on("error", (err) => {
      if (logStream) logStream.end();
      reject(err);
    });

    child.on("close", (code) => {
      if (logStream) logStream.end();
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error: CommandError = new Error(`Command failed: ${command} ${args.join(" ")}`);
        error.code = code ?? undefined;
        error.stdout = stdout;
        error.stderr = stderr;
        error.logFile = options.logFile;
        reject(error);
      }
    });
  });

export const ensureDir = async (dirPath: string): Promise<void> => {
  await fsExtra.mkdirp(dirPath);
};

export const writeJson = async (filePath: string, data: unknown): Promise<void> => {
  await ensureDir(path.dirname(filePath));
  await fsExtra.writeJson(filePath, data, { spaces: 2 });
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const getListeningPorts = async (): Promise<Set<number>> => {
  try {
    const { stdout } = await runCommand("ss", ["-tlnH"]);
    const ports = new Set<number>();

    for (const line of stdout.split("\n")) {
      const match = line.match(/:(\d+)\s/);
      if (match) {
        ports.add(Number.parseInt(match[1], 10));
      }
    }

    return ports;
  } catch {
    return new Set();
  }
};

export const rotateLogsInDirectory = async (logsDir: string, maxAgeDays = 7, maxFiles = 50): Promise<void> => {
  try {
    if (!fs.existsSync(logsDir)) {
      return;
    }

    const files = await fsExtra.readdir(logsDir);
    const logFiles = files.filter(f => f.endsWith('.log'));

    if (logFiles.length === 0) {
      return;
    }

    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const filesToDelete: string[] = [];

    const fileStats = await Promise.all(
      logFiles.map(async (file) => {
        const filePath = path.join(logsDir, file);
        const stat = await fsExtra.stat(filePath);
        return { file, filePath, mtime: stat.mtime.getTime() };
      })
    );

    for (const { filePath, mtime } of fileStats) {
      if (now - mtime > maxAgeMs) {
        filesToDelete.push(filePath);
      }
    }

    const sortedFiles = fileStats.sort((a, b) => b.mtime - a.mtime);
    if (sortedFiles.length > maxFiles) {
      for (const { filePath } of sortedFiles.slice(maxFiles)) {
        if (!filesToDelete.includes(filePath)) {
          filesToDelete.push(filePath);
        }
      }
    }

    await Promise.all(filesToDelete.map(filePath => fsExtra.remove(filePath)));
  } catch (error) {
  }
};

export { ora };
