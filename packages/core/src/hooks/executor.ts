import { spawn } from "node:child_process";
import { err, isErr, ok, type Result } from "@aku11i/phantom-shared";
import { execInWorktree } from "../exec.ts";
import { getWorktreePathFromDirectory } from "../paths.ts";
import { copyFiles } from "../worktree/file-copier.ts";
import { HOOK_DEFAULTS, type HookConfig, type HookType } from "./types.ts";

export interface HookExecutionContext {
  gitRoot: string;
  worktreesDirectory: string;
  worktreeName: string;
  directoryNameSeparator?: string;
}

export interface HookExecutionResult {
  executedCommands: string[];
  backgroundCommands: string[];
}

export async function executeHook(
  hookType: HookType,
  hookConfig: HookConfig | undefined,
  context: HookExecutionContext,
): Promise<Result<HookExecutionResult>> {
  if (!hookConfig) {
    return ok({ executedCommands: [], backgroundCommands: [] });
  }

  const defaults = HOOK_DEFAULTS[hookType];
  const background = hookConfig.background ?? defaults.background;
  const failFast = hookConfig.failFast ?? defaults.failFast;

  // Handle copyFiles (only for post-create and post-start)
  if (
    hookConfig.copyFiles &&
    hookConfig.copyFiles.length > 0 &&
    (hookType === "post-create" || hookType === "post-start")
  ) {
    const worktreePath = getWorktreePathFromDirectory(
      context.worktreesDirectory,
      context.worktreeName,
      context.directoryNameSeparator,
    );
    const copyResult = await copyFiles(
      context.gitRoot,
      worktreePath,
      hookConfig.copyFiles,
    );

    if (isErr(copyResult)) {
      // Don't fail on copy errors, just warn
      console.warn(
        `Warning: Failed to copy some files: ${copyResult.error.message}`,
      );
    }
  }

  const commands = hookConfig.commands ?? [];
  if (commands.length === 0) {
    return ok({ executedCommands: [], backgroundCommands: [] });
  }

  if (background) {
    return executeBackground(hookType, commands, context);
  }

  return executeForeground(hookType, commands, context, failFast);
}

async function executeForeground(
  hookType: HookType,
  commands: string[],
  context: HookExecutionContext,
  failFast: boolean,
): Promise<Result<HookExecutionResult>> {
  const executedCommands: string[] = [];
  const errors: string[] = [];

  for (const command of commands) {
    console.log(`Executing ${hookType} command: ${command}`);
    const shell = process.env.SHELL || "/bin/sh";
    const cmdResult = await execInWorktree(
      context.gitRoot,
      context.worktreesDirectory,
      context.worktreeName,
      [shell, "-c", command],
    );

    if (isErr(cmdResult)) {
      const errorMessage =
        cmdResult.error instanceof Error
          ? cmdResult.error.message
          : String(cmdResult.error);
      const msg = `Failed to execute ${hookType} command "${command}": ${errorMessage}`;

      if (failFast) {
        return err(new Error(msg));
      }
      errors.push(msg);
      continue;
    }

    if (cmdResult.value.exitCode !== 0) {
      const msg = `${hookType} command failed with exit code ${cmdResult.value.exitCode}: ${command}`;

      if (failFast) {
        return err(new Error(msg));
      }
      errors.push(msg);
      continue;
    }

    executedCommands.push(command);
  }

  if (errors.length > 0) {
    return err(new Error(errors.join("\n")));
  }

  return ok({ executedCommands, backgroundCommands: [] });
}

function executeBackground(
  hookType: HookType,
  commands: string[],
  context: HookExecutionContext,
): Result<HookExecutionResult> {
  const shell = process.env.SHELL || "/bin/sh";
  const backgroundCommands: string[] = [];
  const worktreePath = getWorktreePathFromDirectory(
    context.worktreesDirectory,
    context.worktreeName,
    context.directoryNameSeparator,
  );

  for (const command of commands) {
    const child = spawn(shell, ["-c", command], {
      cwd: worktreePath,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    console.log(
      `Started background ${hookType} command: ${command} (pid: ${child.pid})`,
    );
    backgroundCommands.push(command);
  }

  return ok({ executedCommands: [], backgroundCommands });
}
