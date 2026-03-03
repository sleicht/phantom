import { existsSync } from "node:fs";
import { attachWorktree, branchExists } from "@aku11i/phantom-git";
import { err, isErr, ok, type Result } from "@aku11i/phantom-shared";
import { executeHook } from "../hooks/executor.ts";
import type { HooksConfig } from "../hooks/types.ts";
import { getWorktreePathFromDirectory } from "../paths.ts";
import {
  BranchNotFoundError,
  WorktreeAlreadyExistsError,
  WorktreeError,
} from "./errors.ts";
import { validateWorktreeName } from "./validate.ts";

export async function attachWorktreeCore(
  gitRoot: string,
  worktreeDirectory: string,
  name: string,
  hooks: HooksConfig,
): Promise<Result<string, Error>> {
  const validation = validateWorktreeName(name);
  if (isErr(validation)) {
    return validation;
  }

  const worktreePath = getWorktreePathFromDirectory(worktreeDirectory, name);

  const hookContext = {
    gitRoot,
    worktreesDirectory: worktreeDirectory,
    worktreeName: name,
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

  const attachResult = await attachWorktree(gitRoot, worktreePath, name);
  if (isErr(attachResult)) {
    return err(attachResult.error);
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

  return ok(worktreePath);
}
