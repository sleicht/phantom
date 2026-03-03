export type HookType =
  | "pre-create"
  | "post-create"
  | "post-start"
  | "pre-delete"
  | "post-delete";

export type FutureHookType =
  | "pre-switch"
  | "post-switch"
  | "pre-commit"
  | "pre-merge"
  | "post-merge";

export const ALL_HOOK_TYPES: readonly (HookType | FutureHookType)[] = [
  "pre-create",
  "post-create",
  "post-start",
  "pre-delete",
  "post-delete",
  "pre-switch",
  "post-switch",
  "pre-commit",
  "pre-merge",
  "post-merge",
];

export const FUTURE_HOOK_TYPES: readonly FutureHookType[] = [
  "pre-switch",
  "post-switch",
  "pre-commit",
  "pre-merge",
  "post-merge",
];

export interface HookConfig {
  commands?: string[];
  copyFiles?: string[];
  background?: boolean;
  failFast?: boolean;
}

export type HooksConfig = Partial<
  Record<HookType | FutureHookType, HookConfig>
>;

export interface HookDefaults {
  background: boolean;
  failFast: boolean;
}

export const HOOK_DEFAULTS: Record<HookType, HookDefaults> = {
  "pre-create": { background: false, failFast: true },
  "post-create": { background: false, failFast: false },
  "post-start": { background: true, failFast: false },
  "pre-delete": { background: false, failFast: true },
  "post-delete": { background: true, failFast: false },
};
