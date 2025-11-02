import readline from "readline";
import { ora } from "../utils";

export interface Logger {
  start(text: string): void;
  update(text: string): void;
  succeed(text: string): void;
  fail(text: string): void;
  info(text: string): void;
  isVerbose(): boolean;
}

export const createLogger = (verbose: boolean): Logger => {
  const spinner = verbose ? null : ora();

  return {
    start: (text: string) => {
      if (spinner) {
        spinner.start(text);
      } else {
        console.log(text);
      }
    },
    update: (text: string) => {
      if (spinner) {
        spinner.text = text;
      }
    },
    succeed: (text: string) => {
      if (spinner) {
        spinner.succeed(text);
      } else {
        console.log(text);
      }
    },
    fail: (text: string) => {
      if (spinner) {
        spinner.fail(text);
      } else {
        console.log(text);
      }
    },
    info: (text: string) => {
      if (spinner) {
        spinner.info(text);
      } else {
        console.log(text);
      }
    },
    isVerbose: () => verbose,
  };
};

export const confirmPrompt = (message: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
};
