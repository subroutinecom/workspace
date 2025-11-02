import { runCommand } from "./process";
import { pathExists } from "./fs";

export const installDevTools = async (markerPath: string) => {
  if (await pathExists(markerPath)) {
    return;
  }
  console.log("Installing codex...");
  const codexCheck = await runCommand("which", ["codex"], { ignoreFailure: true });
  if (codexCheck.code !== 0) {
    const installResult = await runCommand("npm", ["install", "-g", "@openai/codex"], { ignoreFailure: true });
    if (installResult.code === 0) {
      console.log("✓ codex installed successfully.");
    } else {
      console.log("WARNING: Failed to install codex.");
    }
    return;
  }
  const updateResult = await runCommand("npm", ["update", "-g", "@openai/codex"], { ignoreFailure: true });
  if (updateResult.code === 0) {
    console.log("✓ codex updated successfully.");
  } else {
    console.log("WARNING: Failed to update codex.");
  }
};
