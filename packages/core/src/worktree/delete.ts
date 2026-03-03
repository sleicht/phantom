import { isAbsolute, relative } from "node:path";
import type { HooksConfig } from "@phantompane/config";
import {
  deleteBranch as gitDeleteBranch,
  getStatus,
  removeWorktree as gitRemoveWorktree,
} from "@phantompane/git";
import { err, isErr, isOk, ok, type Result } from "@phantompane/utils";
import { executeHook } from "../hooks/executor.ts";
import type { WorktreeLogger } from "./action.ts";
import { WorktreeError, type WorktreeNotFoundError } from "./errors.ts";
import { validateWorktreeExists } from "./validate.ts";

export interface DeleteWorktreeOptions {
  force?: boolean;
  keepBranch?: boolean;
  path?: string;
  logger?: WorktreeLogger;
}

export interface DeleteWorktreeSuccess {
  message: string;
  hasUncommittedChanges?: boolean;
  changedFiles?: number;
}

export interface WorktreeStatus {
  hasUncommittedChanges: boolean;
  changedFiles: number;
}

export async function getWorktreeChangesStatus(
  worktreePath: string,
): Promise<WorktreeStatus> {
  try {
    const status = await getStatus({ cwd: worktreePath });
    if (!status.isClean) {
      return {
        hasUncommittedChanges: true,
        changedFiles: status.entries.length,
      };
    }
  } catch {
    // If git status fails, assume no changes
  }
  return {
    hasUncommittedChanges: false,
    changedFiles: 0,
  };
}

export async function removeWorktree(
  gitRoot: string,
  worktreePath: string,
  force = false,
): Promise<void> {
  await gitRemoveWorktree({
    gitRoot,
    path: worktreePath,
    force,
  });
}

export async function deleteBranch(
  gitRoot: string,
  branchName: string,
): Promise<Result<boolean, WorktreeError>> {
  try {
    await gitDeleteBranch({
      gitRoot,
      branch: branchName,
    });
    return ok(true);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return err(new WorktreeError(`branch delete failed: ${errorMessage}`));
  }
}

export async function deleteWorktree(
  gitRoot: string,
  worktreeDirectory: string,
  name: string,
  options: DeleteWorktreeOptions,
  hooks: HooksConfig,
  directoryNameSeparator: string,
): Promise<
  Result<DeleteWorktreeSuccess, WorktreeNotFoundError | WorktreeError>
> {
  const { force = false, logger } = options || {};
  const keepBranch = options?.keepBranch ?? false;
  const validateOptions: { excludeDefault: true; expectedPath?: string } = {
    excludeDefault: true,
  };
  if (options?.path) {
    validateOptions.expectedPath = options.path;
  }

  const validation = await validateWorktreeExists(
    gitRoot,
    worktreeDirectory,
    name,
    validateOptions,
  );
  if (isErr(validation)) {
    return err(validation.error);
  }

  const worktreePath = validation.value.path;
  if (!isPathInsideDirectory(worktreePath, worktreeDirectory)) {
    return err(
      new WorktreeError(
        `Worktree '${name}' is not managed by Phantom and cannot be deleted.`,
      ),
    );
  }

  const status = await getWorktreeChangesStatus(worktreePath);

  if (status.hasUncommittedChanges && !force) {
    return err(
      new WorktreeError(
        `Worktree '${name}' has uncommitted changes (${status.changedFiles} files). Use --force to delete anyway.`,
      ),
    );
  }

  const hookContext = {
    gitRoot,
    worktreesDirectory: worktreeDirectory,
    worktreeName: name,
    directoryNameSeparator,
    logger,
  };

  // Execute pre-delete hook (blocking, fail-fast)
  if (hooks["pre-delete"]) {
    logger?.log?.("\nRunning pre-delete hooks...");
    const preDeleteResult = await executeHook(
      "pre-delete",
      hooks["pre-delete"],
      hookContext,
    );

    if (isErr(preDeleteResult)) {
      return err(new WorktreeError(preDeleteResult.error.message));
    }
  }

  try {
    await removeWorktree(gitRoot, worktreePath, force);

    const branchName = name;
    let message: string;
    if (keepBranch) {
      message = `Deleted worktree '${name}' and kept its branch '${branchName}'`;
    } else {
      const branchResult = await deleteBranch(gitRoot, branchName);
      if (isOk(branchResult)) {
        message = `Deleted worktree '${name}' and its branch '${branchName}'`;
      } else {
        message = `Deleted worktree '${name}'`;
        message += `\nNote: Branch '${branchName}' could not be deleted: ${branchResult.error.message}`;
      }
    }

    if (status.hasUncommittedChanges) {
      message = `Warning: Worktree '${name}' had uncommitted changes (${status.changedFiles} files)\n${message}`;
    }

    // Execute post-delete hook (background)
    if (hooks["post-delete"]) {
      executeHook("post-delete", hooks["post-delete"], hookContext);
    }

    return ok({
      message,
      hasUncommittedChanges: status.hasUncommittedChanges,
      changedFiles: status.hasUncommittedChanges
        ? status.changedFiles
        : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return err(new WorktreeError(`worktree remove failed: ${errorMessage}`));
  }
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  const relativePath = relative(directory, path);
  return Boolean(
    relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath),
  );
}
