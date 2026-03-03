import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it, mock } from "node:test";
import { err, ok } from "@aku11i/phantom-shared";

const execInWorktreeMock = mock.fn();
const copyFilesMock = mock.fn();
const getWorktreePathFromDirectoryMock = mock.fn(
  (worktreeDirectory, name) => `${worktreeDirectory}/${name}`,
);
const spawnMock = mock.fn(() => ({
  unref: mock.fn(),
}));

mock.module("../exec.ts", {
  namedExports: {
    execInWorktree: execInWorktreeMock,
  },
});

mock.module("../worktree/file-copier.ts", {
  namedExports: {
    copyFiles: copyFilesMock,
  },
});

mock.module("../paths.ts", {
  namedExports: {
    getWorktreePathFromDirectory: getWorktreePathFromDirectoryMock,
  },
});

mock.module("node:child_process", {
  namedExports: {
    spawn: spawnMock,
  },
});

const { executeHook } = await import("./executor.ts");
const { isOk, isErr } = await import("@aku11i/phantom-shared");

const defaultContext = {
  gitRoot: "/repo",
  worktreesDirectory: "/repo/.git/phantom/worktrees",
  worktreeName: "test",
};

describe("executeHook", () => {
  const resetMocks = () => {
    execInWorktreeMock.mock.resetCalls();
    copyFilesMock.mock.resetCalls();
    getWorktreePathFromDirectoryMock.mock.resetCalls();
    spawnMock.mock.resetCalls();
  };

  it("should return ok for undefined hook config", async () => {
    resetMocks();
    const result = await executeHook("post-create", undefined, defaultContext);
    strictEqual(isOk(result), true);
    deepStrictEqual(result.value.executedCommands, []);
  });

  it("should return ok for empty commands", async () => {
    resetMocks();
    const result = await executeHook(
      "post-create",
      { commands: [] },
      defaultContext,
    );
    strictEqual(isOk(result), true);
    deepStrictEqual(result.value.executedCommands, []);
  });

  describe("foreground execution", () => {
    it("should execute commands sequentially", async () => {
      resetMocks();
      execInWorktreeMock.mock.mockImplementation(() =>
        Promise.resolve(ok({ exitCode: 0, stdout: "", stderr: "" })),
      );

      const result = await executeHook(
        "post-create",
        { commands: ["cmd1", "cmd2"] },
        defaultContext,
      );

      strictEqual(isOk(result), true);
      deepStrictEqual(result.value.executedCommands, ["cmd1", "cmd2"]);
      strictEqual(execInWorktreeMock.mock.calls.length, 2);
    });

    it("should fail fast for pre-create hooks (default failFast=true)", async () => {
      resetMocks();
      let callCount = 0;
      execInWorktreeMock.mock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(ok({ exitCode: 1, stdout: "", stderr: "" }));
        }
        return Promise.resolve(ok({ exitCode: 0, stdout: "", stderr: "" }));
      });

      const result = await executeHook(
        "pre-create",
        { commands: ["cmd1", "cmd2"] },
        defaultContext,
      );

      strictEqual(isErr(result), true);
      strictEqual(callCount, 1);
    });

    it("should collect all errors for post-create hooks (default failFast=false)", async () => {
      resetMocks();
      execInWorktreeMock.mock.mockImplementation(() =>
        Promise.resolve(ok({ exitCode: 1, stdout: "", stderr: "" })),
      );

      const result = await executeHook(
        "post-create",
        { commands: ["cmd1", "cmd2"] },
        defaultContext,
      );

      strictEqual(isErr(result), true);
      // Both commands should have been attempted
      strictEqual(execInWorktreeMock.mock.calls.length, 2);
    });

    it("should respect failFast override", async () => {
      resetMocks();
      execInWorktreeMock.mock.mockImplementation(() =>
        Promise.resolve(ok({ exitCode: 1, stdout: "", stderr: "" })),
      );

      const result = await executeHook(
        "post-create",
        { commands: ["cmd1", "cmd2"], failFast: true },
        defaultContext,
      );

      strictEqual(isErr(result), true);
      // Should stop after first failure
      strictEqual(execInWorktreeMock.mock.calls.length, 1);
    });

    it("should handle command execution error", async () => {
      resetMocks();
      execInWorktreeMock.mock.mockImplementation(() =>
        Promise.resolve(err(new Error("exec failed"))),
      );

      const result = await executeHook(
        "pre-delete",
        { commands: ["bad-cmd"] },
        defaultContext,
      );

      strictEqual(isErr(result), true);
      strictEqual(
        result.error.message.includes("Failed to execute pre-delete command"),
        true,
      );
    });
  });

  describe("background execution", () => {
    it("should spawn detached processes for background hooks", () => {
      resetMocks();
      executeHook("post-start", { commands: ["pnpm dev"] }, defaultContext);

      // post-start defaults to background=true, so spawn should be called
      strictEqual(spawnMock.mock.calls.length, 1);
      const spawnArgs = spawnMock.mock.calls[0].arguments;
      strictEqual(spawnArgs[1][1], "pnpm dev");
      strictEqual(spawnArgs[2].detached, true);
      strictEqual(spawnArgs[2].stdio, "ignore");
    });

    it("should respect background override", async () => {
      resetMocks();
      execInWorktreeMock.mock.mockImplementation(() =>
        Promise.resolve(ok({ exitCode: 0, stdout: "", stderr: "" })),
      );

      // Override post-start to foreground
      const result = await executeHook(
        "post-start",
        { commands: ["cmd1"], background: false },
        defaultContext,
      );

      strictEqual(isOk(result), true);
      strictEqual(spawnMock.mock.calls.length, 0);
      strictEqual(execInWorktreeMock.mock.calls.length, 1);
    });
  });

  describe("copyFiles", () => {
    it("should copy files for post-create hooks", async () => {
      resetMocks();
      copyFilesMock.mock.mockImplementation(() =>
        Promise.resolve(ok({ copiedFiles: [".env"], skippedFiles: [] })),
      );

      const result = await executeHook(
        "post-create",
        { copyFiles: [".env"] },
        defaultContext,
      );

      strictEqual(isOk(result), true);
      strictEqual(copyFilesMock.mock.calls.length, 1);
    });

    it("should not copy files for pre-delete hooks", async () => {
      resetMocks();
      const result = await executeHook(
        "pre-delete",
        { copyFiles: [".env"] },
        defaultContext,
      );

      strictEqual(isOk(result), true);
      strictEqual(copyFilesMock.mock.calls.length, 0);
    });

    it("should warn but not fail on copy errors", async () => {
      resetMocks();
      copyFilesMock.mock.mockImplementation(() =>
        Promise.resolve(err(new Error("copy failed"))),
      );
      const warnMock = mock.method(console, "warn");

      const result = await executeHook(
        "post-create",
        { copyFiles: [".env"] },
        defaultContext,
      );

      strictEqual(isOk(result), true);
      strictEqual(warnMock.mock.calls.length >= 1, true);
      warnMock.mock.restore();
    });
  });
});
