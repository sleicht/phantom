import fs from "node:fs/promises";
import type { HooksConfig } from "@phantompane/config";
import { addWorktree, getGitRoot } from "@phantompane/git";
import { err, isErr, isOk, ok, type Result } from "@phantompane/utils";
import { createContext } from "../context.ts";
import { executeHook } from "../hooks/executor.ts";
import { getWorktreePathFromDirectory } from "../paths.ts";
import {
  mergeWorktreeCopyFiles,
  resolveWorktreeAction,
  runWorktreeAction,
  validateWorktreeAction,
  type WorktreeActionOptions,
  type WorktreeLogger,
} from "./action.ts";
import { type WorktreeAlreadyExistsError, WorktreeError } from "./errors.ts";
import { copyFiles } from "./file-copier.ts";
import { generateUniqueName } from "./generate-name.ts";
import {
  validateWorktreeDoesNotExist,
  validateWorktreeName,
} from "./validate.ts";

export interface CreateWorktreeOptions {
  branch?: string;
  base?: string;
  copyFiles?: string[];
  logger?: WorktreeLogger;
}

export interface CreateWorktreeSuccess {
  message: string;
  path: string;
  copiedFiles?: string[];
  skippedFiles?: string[];
  copyError?: string;
}

export interface RunCreateWorktreeOptions {
  name?: string;
  gitRoot?: string;
  base?: string;
  copyFiles?: string[];
  action?: WorktreeActionOptions;
  logger?: WorktreeLogger;
}

export interface RunCreateWorktreeSuccess {
  name: string;
  path: string;
  message: string;
  copyError?: string;
  exitProcessCode?: number;
}

export async function createWorktree(
  gitRoot: string,
  worktreeDirectory: string,
  name: string,
  options: CreateWorktreeOptions,
  hooks: HooksConfig,
  directoryNameSeparator: string,
): Promise<
  Result<CreateWorktreeSuccess, WorktreeAlreadyExistsError | WorktreeError>
> {
  const nameValidation = validateWorktreeName(name);
  if (isErr(nameValidation)) {
    return nameValidation;
  }

  const {
    branch = name,
    base = "HEAD",
    copyFiles: requestedCopyFiles,
    logger,
  } = options;

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
      cwd: gitRoot,
    });

    let copiedFiles: string[] | undefined;
    let skippedFiles: string[] | undefined;
    let copyError: string | undefined;

    // The post-create hook's copyFiles are copied here so that the result is
    // reported to the caller; they are stripped from the hook config below to
    // avoid copying them twice.
    const { copyFiles: postCreateCopyFiles, ...postCreateHook } =
      hooks["post-create"] ?? {};

    const filesToCopy = mergeWorktreeCopyFiles(
      postCreateCopyFiles,
      requestedCopyFiles,
    );

    if (filesToCopy) {
      const copyResult = await copyFiles(gitRoot, worktreePath, filesToCopy);

      if (isOk(copyResult)) {
        copiedFiles = copyResult.value.copiedFiles;
        skippedFiles = copyResult.value.skippedFiles;
      } else {
        copyError = copyResult.error.message;
      }
    }

    // Execute post-create hook (blocking)
    if (hooks["post-create"]) {
      logger?.log?.("\nRunning post-create hooks...");
      const postCreateResult = await executeHook(
        "post-create",
        postCreateHook,
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

export async function runCreateWorktree(
  options: RunCreateWorktreeOptions,
): Promise<Result<RunCreateWorktreeSuccess>> {
  const actionResult = resolveWorktreeAction(options.action);
  if (isErr(actionResult)) {
    return actionResult;
  }

  const actionValidation = await validateWorktreeAction(actionResult.value);
  if (isErr(actionValidation)) {
    return actionValidation;
  }

  try {
    const gitRoot = options.gitRoot ?? (await getGitRoot());
    const context = await createContext(gitRoot);

    let worktreeName = options.name;
    if (!worktreeName) {
      const nameResult = await generateUniqueName(
        context.gitRoot,
        context.worktreesDirectory,
        context.directoryNameSeparator,
      );
      if (isErr(nameResult)) {
        return err(nameResult.error);
      }
      worktreeName = nameResult.value;
    }

    const createResult = await createWorktree(
      context.gitRoot,
      context.worktreesDirectory,
      worktreeName,
      {
        base: options.base,
        copyFiles: options.copyFiles,
        logger: options.logger,
      },
      context.hooks,
      context.directoryNameSeparator,
    );
    if (isErr(createResult)) {
      return err(createResult.error);
    }

    options.logger?.log(createResult.value.message);

    if (createResult.value.copyError) {
      options.logger?.warn?.(
        `\nWarning: Failed to copy some files: ${createResult.value.copyError}`,
      );
    }

    const worktreeActionResult = await runWorktreeAction({
      gitRoot: context.gitRoot,
      worktreeDirectory: context.worktreesDirectory,
      worktreeName,
      worktreePath: createResult.value.path,
      action: actionResult.value,
      logger: options.logger,
      exitWithProcessCode: true,
    });
    if (isErr(worktreeActionResult)) {
      return err(worktreeActionResult.error);
    }

    return ok({
      name: worktreeName,
      path: createResult.value.path,
      message: createResult.value.message,
      copyError: createResult.value.copyError,
      exitProcessCode: worktreeActionResult.value.exitProcessCode,
    });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
