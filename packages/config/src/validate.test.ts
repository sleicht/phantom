import assert from "node:assert";
import { describe, test } from "vitest";
import { isErr, isOk } from "@phantompane/utils";
import { ConfigValidationError, validateConfig } from "./validate.ts";

describe("validateConfig", () => {
  test("should accept valid config with postCreate and copyFiles", () => {
    const config = {
      postCreate: {
        copyFiles: [".env", "config/local.json"],
      },
    };

    const result = validateConfig(config);

    assert.strictEqual(isOk(result), true);
    if (isOk(result)) {
      assert.deepStrictEqual(result.value, config);
    }
  });

  test("should accept empty config object", () => {
    const config = {};

    const result = validateConfig(config);

    assert.strictEqual(isOk(result), true);
    if (isOk(result)) {
      assert.deepStrictEqual(result.value, config);
    }
  });

  test("should accept config with both postCreate and preDelete", () => {
    const config = {
      postCreate: {
        copyFiles: [".env"],
        commands: ["pnpm install"],
      },
      preDelete: {
        commands: ["docker stop my-container"],
      },
    };

    const result = validateConfig(config);

    assert.strictEqual(isOk(result), true);
    if (isOk(result)) {
      assert.deepStrictEqual(result.value, config);
    }
  });

  test("should accept config with worktreesDirectory and separator", () => {
    const config = {
      worktreesDirectory: "../phantom-worktrees",
      directoryNameSeparator: "-",
    };

    const result = validateConfig(config);

    assert.strictEqual(isOk(result), true);
    if (isOk(result)) {
      assert.deepStrictEqual(result.value, config);
    }
  });

  describe("hooks config", () => {
    test("should accept config with new hooks format", () => {
      const config = {
        hooks: {
          "post-create": {
            commands: ["pnpm install"],
            copyFiles: [".env"],
          },
          "pre-delete": {
            commands: ["docker compose down"],
          },
        },
      };

      const result = validateConfig(config);

      assert.strictEqual(isOk(result), true);
      if (isOk(result)) {
        assert.deepStrictEqual(result.value, config);
      }
    });

    test("should accept hooks with background and failFast overrides", () => {
      const config = {
        hooks: {
          "post-create": {
            commands: ["pnpm install"],
            background: true,
            failFast: false,
          },
        },
      };

      const result = validateConfig(config);

      assert.strictEqual(isOk(result), true);
      if (isOk(result)) {
        assert.deepStrictEqual(result.value, config);
      }
    });

    test("should accept hooks with all hook types", () => {
      const config = {
        hooks: {
          "pre-create": { commands: ["echo pre"] },
          "post-create": { commands: ["pnpm install"], copyFiles: [".env"] },
          "post-start": { commands: ["pnpm dev"] },
          "pre-delete": { commands: ["docker compose down"] },
          "post-delete": { commands: ["echo done"] },
        },
      };

      const result = validateConfig(config);

      assert.strictEqual(isOk(result), true);
    });

    test("should accept future hook types", () => {
      const config = {
        hooks: {
          "pre-switch": { commands: ["echo switch"] },
          "post-switch": { commands: ["echo switched"] },
        },
      };

      const result = validateConfig(config);

      assert.strictEqual(isOk(result), true);
    });

    test("should accept empty hooks object", () => {
      const config = { hooks: {} };

      const result = validateConfig(config);

      assert.strictEqual(isOk(result), true);
    });

    test("should accept config with both hooks and legacy keys", () => {
      const config = {
        hooks: {
          "post-create": { commands: ["pnpm install"] },
        },
        postCreate: {
          commands: ["legacy command"],
        },
      };

      const result = validateConfig(config);

      assert.strictEqual(isOk(result), true);
    });

    test("should reject unknown hook types", () => {
      const result = validateConfig({
        hooks: {
          "not-a-hook": { commands: ["echo nope"] },
        },
      });

      assert.strictEqual(isErr(result), true);
      if (isErr(result)) {
        assert.ok(result.error instanceof ConfigValidationError);
      }
    });
  });

  test("should reject non-object config", () => {
    const result = validateConfig("not an object");

    assert.strictEqual(isErr(result), true);
    if (isErr(result)) {
      assert.ok(result.error instanceof ConfigValidationError);
      assert.strictEqual(
        result.error.message,
        "Invalid phantom.config.json: Invalid input: expected object, received string",
      );
    }
  });

  test("should reject invalid nested properties", () => {
    const result = validateConfig({
      postCreate: {
        copyFiles: [123],
      },
    });

    assert.strictEqual(isErr(result), true);
    if (isErr(result)) {
      assert.ok(result.error instanceof ConfigValidationError);
      assert.strictEqual(
        result.error.message,
        "Invalid phantom.config.json: postCreate.copyFiles.0: Invalid input: expected string, received number",
      );
    }
  });
});
