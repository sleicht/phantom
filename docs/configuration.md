# Phantom Configuration

## Table of Contents

- [Configuration File](#configuration-file)
- [Hooks](#hooks)
  - [Hook Types](#hook-types)
  - [Hook Options](#hook-options)
  - [copyFiles](#copyfiles)
  - [Commands](#commands)
- [Legacy Configuration](#legacy-configuration)
- [Other Options](#other-options)
  - [worktreesDirectory](#worktreesdirectory)
  - [directoryNameSeparator](#directorynameseparator)

Phantom supports configuration through a `phantom.config.json` file in your repository root. This allows you to define lifecycle hooks that run at various stages of worktree creation and deletion. For personal defaults such as `worktreesDirectory`, prefer `phantom preferences` (stored in your global git config); the `worktreesDirectory` key in `phantom.config.json` is deprecated and will be removed in the next version.

## Configuration File

Create a `phantom.config.json` file in your repository root:

```json
{
  "hooks": {
    "post-create": {
      "copyFiles": [".env", ".env.local"],
      "commands": ["pnpm install", "pnpm build"]
    },
    "post-start": {
      "commands": ["pnpm dev"]
    },
    "pre-delete": {
      "commands": ["docker compose down"]
    },
    "post-delete": {
      "commands": ["echo 'cleaned up'"]
    }
  }
}
```

## Hooks

Hooks are lifecycle commands that run at specific stages of worktree operations. Each hook type has default behaviour for whether it runs in the foreground (blocking) or background, and whether it stops on the first error (fail-fast).

### Hook Types

| Hook | When | Blocking | Fail-fast | copyFiles |
|------|------|----------|-----------|-----------|
| `pre-create` | Before worktree creation | Yes | Yes | No |
| `post-create` | After worktree created | Yes | No | Yes |
| `post-start` | After worktree created | No (background) | No | Yes |
| `pre-delete` | Before worktree removed | Yes | Yes | No |
| `post-delete` | After worktree removed | No (background) | No | No |

**Blocking** hooks run in the foreground — the CLI waits for them to complete before continuing. **Background** hooks are fire-and-forget — the CLI returns immediately while the command continues running.

**Fail-fast** hooks stop on the first failed command and abort the operation. Non-fail-fast hooks attempt all commands and report errors at the end.

**Future hook types** (`pre-switch`, `post-switch`, `pre-commit`, `pre-merge`, `post-merge`) are accepted in configuration but not yet wired up. They will emit an info message if configured.

### Hook Options

Each hook can have the following options:

```json
{
  "hooks": {
    "post-create": {
      "commands": ["pnpm install"],
      "copyFiles": [".env"],
      "background": false,
      "failFast": true
    }
  }
}
```

- **commands** — Array of shell commands to execute
- **copyFiles** — Array of file paths/glob patterns to copy (only for `post-create` and `post-start`)
- **background** — Override the default blocking/background behaviour
- **failFast** — Override the default fail-fast behaviour

### copyFiles

An array of file paths or glob patterns to automatically copy from the current worktree to newly created worktrees. Only supported in `post-create` and `post-start` hooks.

**Use Cases:**
- Environment configuration files (`.env`, `.env.local`)
- Local development settings across subdirectories
- Secret files that are gitignored
- Database configuration files

**Example:**
```json
{
  "hooks": {
    "post-create": {
      "copyFiles": [
        ".env",
        ".env*",
        "config/**/*.local.yml",
        "secrets/[ab]*.json"
      ]
    }
  }
}
```

**Glob Pattern Support:**

- `*` — Matches any characters except `/`
- `**` — Matches any characters including `/` (recursive)
- `?` — Matches any single character
- `[abc]` — Matches any character in the brackets

**Notes:**
- Paths and patterns are relative to the repository root
- Exact file paths and glob patterns can be mixed in the same array
- Patterns matching no files are silently skipped
- Directories are excluded from copying (only files are copied)
- Overlapping patterns are automatically deduplicated
- Can also be passed via `--copy-file` command line options (merged with config)

### Commands

An array of commands to execute at the hook's lifecycle stage.

**Example:**
```json
{
  "hooks": {
    "post-create": {
      "commands": [
        "pnpm install",
        "pnpm db:migrate",
        "pnpm db:seed"
      ]
    },
    "pre-delete": {
      "commands": [
        "docker compose down"
      ]
    }
  }
}
```

**Notes:**
- Commands are executed in order
- Commands run in the worktree's directory
- Output is displayed in real-time (foreground hooks only)
- For `pre-create` and `pre-delete` hooks: execution stops on the first failed command (fail-fast) and the operation is aborted
- For `post-create` hooks: all commands are attempted; errors are collected and reported
- For `post-start` and `post-delete` hooks: commands are spawned in the background

## Legacy Configuration

The following format is still accepted but deprecated. A warning will be emitted when legacy keys are used.

```json
{
  "postCreate": {
    "copyFiles": [".env"],
    "commands": ["pnpm install"]
  },
  "preDelete": {
    "commands": ["docker compose down"]
  }
}
```

**Migration:** Move `postCreate` to `hooks["post-create"]` and `preDelete` to `hooks["pre-delete"]`. The new `hooks` format takes precedence if both are present.

## Other Options

### worktreesDirectory

> **Deprecated:** Use `phantom preferences set worktreesDirectory <path>` instead.

A custom base directory where Phantom worktrees will be created. By default, Phantom creates all worktrees in `.git/phantom/worktrees/`.

**Examples:**

```json
{
  "worktreesDirectory": "../phantom-worktrees"
}
```

### directoryNameSeparator

A string used to flatten worktree directory names that contain slashes. When set, slashes in worktree names are replaced with this separator instead of creating nested directories.

**Example:**
```json
{
  "directoryNameSeparator": "-"
}
```

With this setting, a worktree named `feature/my-branch` would be created at `worktrees/feature-my-branch` instead of `worktrees/feature/my-branch`.
