import { existsSync } from "node:fs";
import type { HooksConfig } from "@phantompane/config";
import { addWorktree, branchExists, getGitRoot } from "@phantompane/git";
import { err, isErr, ok, type Result } from "@phantompane/utils";
import { createContext } from "../context.ts";
import { executeHook } from "../hooks/executor.ts";
import { getWorktreePathFromDirectory } from "../paths.ts";
import {
  resolveWorktreeAction,
  runWorktreeAction,
  validateWorktreeAction,
  type WorktreeActionOptions,
  type WorktreeLogger,
} from "./action.ts";
import {
  BranchNotFoundError,
  WorktreeAlreadyExistsError,
  WorktreeError,
} from "./errors.ts";
import { validateWorktreeName } from "./validate.ts";

export interface RunAttachWorktreeOptions {
  name: string;
  copyFiles?: string[];
  action?: WorktreeActionOptions;
  logger?: WorktreeLogger;
}

export interface RunAttachWorktreeSuccess {
  name: string;
  path: string;
}

export async function attachWorktreeCore(
  gitRoot: string,
  worktreeDirectory: string,
  name: string,
  hooks: HooksConfig,
  directoryNameSeparator: string,
  logger?: WorktreeLogger,
): Promise<Result<string, Error>> {
  const validation = validateWorktreeName(name);
  if (isErr(validation)) {
    return validation;
  }

  const worktreePath = getWorktreePathFromDirectory(
    worktreeDirectory,
    name,
    directoryNameSeparator,
  );

  const hookContext = {
    gitRoot,
    worktreesDirectory: worktreeDirectory,
    worktreeName: name,
    directoryNameSeparator,
    logger,
  };

  if (existsSync(worktreePath)) {
    return err(new WorktreeAlreadyExistsError(name));
  }

  const branchCheckResult = await branchExists(gitRoot, name);
  if (isErr(branchCheckResult)) {
    return err(branchCheckResult.error);
  }

  if (!branchCheckResult.value) {
    return err(new BranchNotFoundError(name));
  }

  // Execute pre-create hook (blocking, fail-fast)
  const preCreateResult = await executeHook(
    "pre-create",
    hooks["pre-create"],
    hookContext,
  );
  if (isErr(preCreateResult)) {
    return err(new WorktreeError(preCreateResult.error.message));
  }

  try {
    await addWorktree({
      path: worktreePath,
      branch: name,
      createBranch: false,
      cwd: gitRoot,
    });
  } catch (error) {
    return err(
      error instanceof Error
        ? error
        : new Error(`Failed to attach worktree: ${String(error)}`),
    );
  }

  // Execute post-create hook (blocking)
  if (hooks["post-create"]) {
    logger?.log?.("\nRunning post-create hooks...");
    const postCreateResult = await executeHook(
      "post-create",
      hooks["post-create"],
      hookContext,
    );
    if (isErr(postCreateResult)) {
      return err(new WorktreeError(postCreateResult.error.message));
    }
  }

  // Execute post-start hook (background)
  if (hooks["post-start"]) {
    executeHook("post-start", hooks["post-start"], hookContext);
  }

  return ok(worktreePath);
}

export async function runAttachWorktree(
  options: RunAttachWorktreeOptions,
): Promise<Result<RunAttachWorktreeSuccess>> {
  const actionResult = resolveWorktreeAction(options.action);
  if (isErr(actionResult)) {
    return actionResult;
  }

  const actionValidation = await validateWorktreeAction(actionResult.value);
  if (isErr(actionValidation)) {
    return actionValidation;
  }

  try {
    const gitRoot = await getGitRoot();
    const context = await createContext(gitRoot);

    const hooks = mergeCopyFilesIntoPostCreateHook(
      context.hooks,
      options.copyFiles,
    );

    const attachResult = await attachWorktreeCore(
      context.gitRoot,
      context.worktreesDirectory,
      options.name,
      hooks,
      context.directoryNameSeparator,
      options.logger,
    );
    if (isErr(attachResult)) {
      return err(attachResult.error);
    }

    options.logger?.log(`Attached phantom: ${options.name}`);

    const worktreeActionResult = await runWorktreeAction({
      gitRoot: context.gitRoot,
      worktreeDirectory: context.worktreesDirectory,
      worktreeName: options.name,
      worktreePath: attachResult.value,
      action: actionResult.value,
      logger: options.logger,
    });
    if (isErr(worktreeActionResult)) {
      return err(worktreeActionResult.error);
    }

    return ok({
      name: options.name,
      path: attachResult.value,
    });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

function mergeCopyFilesIntoPostCreateHook(
  hooks: HooksConfig,
  requestedCopyFiles: string[] | undefined,
): HooksConfig {
  if (!requestedCopyFiles || requestedCopyFiles.length === 0) {
    return hooks;
  }

  const postCreate = hooks["post-create"];
  const copyFiles = [
    ...new Set([...(postCreate?.copyFiles ?? []), ...requestedCopyFiles]),
  ];

  return {
    ...hooks,
    "post-create": { ...postCreate, copyFiles },
  };
}
