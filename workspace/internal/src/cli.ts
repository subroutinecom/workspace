import { addSshKeys } from "./commands/add-ssh-key";
import { runEntrypoint } from "./commands/entrypoint";
import { runEnsureServices } from "./commands/ensure-services";
import { runInit } from "./commands/init";

export const runCli = async () => {
  const [, , command, ...rest] = process.argv;
  switch (command) {
    case "entrypoint":
      await runEntrypoint();
      break;
    case "init":
      await runInit();
      break;
    case "ensure-services":
      await runEnsureServices();
      break;
    case "add-ssh-key":
      await addSshKeys();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Available commands: entrypoint, init, ensure-services, add-ssh-key");
      process.exitCode = 1;
      break;
  }
  if (rest.length) {
    void rest;
  }
};
