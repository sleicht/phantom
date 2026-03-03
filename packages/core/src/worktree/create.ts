import fs from "node:fs/promises";
import { addWorktree } from "@aku11i/phantom-git";
import { err, isErr, isOk, ok, type Result } from "@aku11i/phantom-shared";
import { executeHook } from "../hooks/executor.ts";
import type { HooksConfig } from "../hooks/types.ts";
import { getWorktreePathFromDirectory } from "../paths.ts";
import { type WorktreeAlreadyExistsError, WorktreeError } from "./errors.ts";
import { copyFiles } from "./file-copier.ts";
import {
  validateWorktreeDoesNotExist,
  validateWorktreeName,
} from "./validate.ts";

export interface CreateWorktreeOptions {
  branch?: string;
  base?: string;
  copyFiles?: string[];
}

export interface CreateWorktreeSuccess {
  message: string;
  path: string;
  copiedFiles?: string[];
  skippedFiles?: string[];
  copyError?: string;
}

export async function createWorktree(
  gitRoot: string,
  worktreeDirectory: string,
  name: string,
  options: CreateWorktreeOptions,
  hooks: HooksConfig,
): Promise<
  Result<CreateWorktreeSuccess, WorktreeAlreadyExistsError | WorktreeError>
> {
  const nameValidation = validateWorktreeName(name);
  if (isErr(nameValidation)) {
    return nameValidation;
  }

  const { branch = name, base = "HEAD" } = options;

  const worktreePath = getWorktreePathFromDirectory(worktreeDirectory, name);

  const hookContext = {
    gitRoot,
    worktreesDirectory: worktreeDirectory,
    worktreeName: name,
  };

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
    await fs.access(worktreeDirectory);
  } catch {
    await fs.mkdir(worktreeDirectory, { recursive: true });
  }

  const validation = await validateWorktreeDoesNotExist(
    gitRoot,
    worktreeDirectory,
    name,
  );
  if (isErr(validation)) {
    return err(validation.error);
  }

  try {
    await addWorktree({
      path: worktreePath,
      branch,
      base,
    });

    let copiedFiles: string[] | undefined;
    let skippedFiles: string[] | undefined;
    let copyError: string | undefined;

    if (options.copyFiles && options.copyFiles.length > 0) {
      const copyResult = await copyFiles(
        gitRoot,
        worktreePath,
        options.copyFiles,
      );

      if (isOk(copyResult)) {
        copiedFiles = copyResult.value.copiedFiles;
        skippedFiles = copyResult.value.skippedFiles;
      } else {
        copyError = copyResult.error.message;
      }
    }

    // Execute post-create hook (blocking)
    if (hooks["post-create"]) {
      console.log("\nRunning post-create hooks...");
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

    return ok({
      message: `Created worktree '${name}' at ${worktreePath}`,
      path: worktreePath,
      copiedFiles,
      skippedFiles,
      copyError,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return err(new WorktreeError(`worktree add failed: ${errorMessage}`));
  }
}
