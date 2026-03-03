import { err, ok, type Result } from "@phantompane/utils";
import { z } from "zod";
import { ALL_HOOK_TYPES } from "./hooks.ts";

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(`Invalid phantom.config.json: ${message}`);
    this.name = this.constructor.name;
  }
}

const hookConfigSchema = z
  .object({
    commands: z.array(z.string()).optional(),
    copyFiles: z.array(z.string()).optional(),
    background: z.boolean().optional(),
    failFast: z.boolean().optional(),
  })
  .passthrough();

const allHookTypesSet = new Set<string>(ALL_HOOK_TYPES);

const hooksSchema = z
  .record(z.string(), hookConfigSchema.optional())
  .refine((obj) => Object.keys(obj).every((key) => allHookTypesSet.has(key)), {
    message: `Unknown hook type. Valid types: ${ALL_HOOK_TYPES.join(", ")}`,
  })
  .optional();

export const phantomConfigSchema = z
  .object({
    hooks: hooksSchema,
    postCreate: z
      .object({
        copyFiles: z.array(z.string()).optional(),
        commands: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    preDelete: z
      .object({
        commands: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    directoryNameSeparator: z.string().optional(),
    worktreesDirectory: z.string().optional(),
  })
  .passthrough();

export type PhantomConfig = z.infer<typeof phantomConfigSchema>;

export function validateConfig(
  config: unknown,
): Result<PhantomConfig, ConfigValidationError> {
  const result = phantomConfigSchema.safeParse(config);

  if (!result.success) {
    const firstError = result.error.issues[0];
    const path = firstError.path.join(".");
    const message = path
      ? `${path}: ${firstError.message}`
      : firstError.message;

    return err(new ConfigValidationError(message));
  }

  return ok(result.data);
}
