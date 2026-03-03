import type { PhantomConfig } from "../config/loader.ts";
import {
  FUTURE_HOOK_TYPES,
  type FutureHookType,
  type HooksConfig,
} from "./types.ts";

export function resolveHooks(config: PhantomConfig | null): HooksConfig {
  if (!config) {
    return {};
  }

  const hooks: HooksConfig = {};

  // Start with new-format hooks if present
  if (config.hooks) {
    for (const [key, value] of Object.entries(config.hooks)) {
      if (value) {
        hooks[key as keyof HooksConfig] = { ...value };
      }
    }
  }

  // Migrate legacy keys, filling gaps only (new format takes precedence)
  const hasLegacy =
    config.postCreate !== undefined || config.preDelete !== undefined;

  if (config.postCreate && !hooks["post-create"]) {
    hooks["post-create"] = {
      commands: config.postCreate.commands,
      copyFiles: config.postCreate.copyFiles,
    };
  }

  if (config.preDelete && !hooks["pre-delete"]) {
    hooks["pre-delete"] = {
      commands: config.preDelete.commands,
    };
  }

  if (hasLegacy) {
    console.warn(
      "The 'postCreate' and 'preDelete' config keys are deprecated. Use 'hooks' instead. See https://github.com/aku11i/phantom/blob/main/docs/configuration.md",
    );
  }

  // Warn about future hook types
  for (const hookType of FUTURE_HOOK_TYPES) {
    if (hooks[hookType as FutureHookType]) {
      console.info(
        `Hook '${hookType}' is not yet supported and will be ignored.`,
      );
    }
  }

  return hooks;
}
