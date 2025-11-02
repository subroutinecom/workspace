import { addSshKeys } from "./add-ssh-key";
import { runCommand } from "../lib/process";
import { ensureDockerd, monitorServices, startSshd, tailDockerdLogs, waitForDocker } from "../lib/services";

export const runEntrypoint = async () => {
  console.log("[entrypoint] Adding SSH key...");
  try {
    await addSshKeys();
  } catch (error) {
    console.log(`[entrypoint] Failed to add SSH key (non-fatal): ${(error as Error).message}`);
  }
  console.log("[entrypoint] Fixing workspace directory permissions...");
  await runCommand("chown", ["-R", "workspace:workspace", "/home/workspace/.cache"], { ignoreFailure: true });
  console.log("[entrypoint] Starting Docker daemon...");
  ensureDockerd();
  const ready = await waitForDocker();
  if (!ready) {
    process.exit(1);
    return;
  }
  console.log("[entrypoint] Starting SSH daemon...");
  await startSshd();
  void monitorServices();
  await tailDockerdLogs();
};
