import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it, vi } from "vitest";

const { resolveHooks } = await import("./resolve.ts");

describe("resolveHooks", () => {
  it("should return empty hooks for null config", () => {
    const result = resolveHooks(null);
    deepStrictEqual(result, {});
  });

  it("should return empty hooks for config without hooks or legacy keys", () => {
    const result = resolveHooks({});
    deepStrictEqual(result, {});
  });

  it("should migrate legacy postCreate to hooks", () => {
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = resolveHooks({
      postCreate: {
        copyFiles: [".env"],
        commands: ["pnpm install"],
      },
    });

    deepStrictEqual(result["post-create"], {
      copyFiles: [".env"],
      commands: ["pnpm install"],
    });
    strictEqual(warnMock.mock.calls.length >= 1, true);
    warnMock.mockRestore();
  });

  it("should migrate legacy preDelete to hooks", () => {
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = resolveHooks({
      preDelete: {
        commands: ["docker compose down"],
      },
    });

    deepStrictEqual(result["pre-delete"], {
      commands: ["docker compose down"],
    });
    strictEqual(warnMock.mock.calls.length >= 1, true);
    warnMock.mockRestore();
  });

  it("should prefer new hooks format over legacy keys", () => {
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = resolveHooks({
      hooks: {
        "post-create": {
          commands: ["new-command"],
        },
      },
      postCreate: {
        commands: ["legacy-command"],
      },
    });

    deepStrictEqual(result["post-create"]?.commands, ["new-command"]);
    warnMock.mockRestore();
  });

  it("should accept new hooks format directly", () => {
    const result = resolveHooks({
      hooks: {
        "post-create": {
          commands: ["pnpm install"],
          copyFiles: [".env"],
        },
        "pre-delete": {
          commands: ["docker compose down"],
        },
        "post-start": {
          commands: ["pnpm dev"],
        },
      },
    });

    deepStrictEqual(result["post-create"]?.commands, ["pnpm install"]);
    deepStrictEqual(result["post-create"]?.copyFiles, [".env"]);
    deepStrictEqual(result["pre-delete"]?.commands, ["docker compose down"]);
    deepStrictEqual(result["post-start"]?.commands, ["pnpm dev"]);
  });

  it("should warn about future hook types", () => {
    const infoMock = vi.spyOn(console, "info").mockImplementation(() => {});

    resolveHooks({
      hooks: {
        "pre-switch": {
          commands: ["echo switch"],
        },
      },
    });

    strictEqual(infoMock.mock.calls.length >= 1, true);
    strictEqual(
      infoMock.mock.calls[0][0],
      "Hook 'pre-switch' is not yet supported and will be ignored.",
    );
    infoMock.mockRestore();
  });
});
