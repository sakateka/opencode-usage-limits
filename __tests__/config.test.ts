import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Redacted, Result } from "effect";
import { afterEach, describe, expect, vi, it } from "vitest";

import {
  credentialValue,
  parseOpenCodeAuth,
  parseUsageLimitsConfig,
} from "@/config-schema.ts";
import { ConfigDecodeError, ConfigReadError } from "@/errors.ts";
import type { JsonValue } from "@/utils.ts";

type ReadJsonFile = (filePath: string) => Promise<JsonValue>;

const readJsonFile = vi.fn<ReadJsonFile>();

const testXdgConfigHome = path.join(homedir(), ".opencode-test-config");
const testXdgDataHome = path.join(homedir(), ".opencode-test-data");
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
const originalXdgDataHome = process.env.XDG_DATA_HOME;

process.env.XDG_CONFIG_HOME = testXdgConfigHome;

process.env.XDG_DATA_HOME = testXdgDataHome;

const {
  defaultOpenCodeAuthPath,
  loadConfig,
  loadOpenCodeAuth,
  resolveXdgPath,
} = await import("@/config.ts");

if (originalXdgConfigHome === undefined) {
  delete process.env.XDG_CONFIG_HOME;
} else {
  process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
}

if (originalXdgDataHome === undefined) {
  delete process.env.XDG_DATA_HOME;
} else {
  process.env.XDG_DATA_HOME = originalXdgDataHome;
}

interface PublishedProviderDefinition {
  properties: object;
}

interface PublishedSchema {
  $defs: {
    kimiProvider: PublishedProviderDefinition;
    codexProvider: PublishedProviderDefinition;
    commonDisplayFields: PublishedProviderDefinition;
    openCodeGoProvider: PublishedProviderDefinition;
    zaiProvider: PublishedProviderDefinition;
  };
  properties: {
    providers: {
      properties: {
        kimi: { $ref: "#/$defs/kimiProvider" };
        codex: { $ref: "#/$defs/codexProvider" };
        "opencode-go": { $ref: "#/$defs/openCodeGoProvider" };
        zai: { $ref: "#/$defs/zaiProvider" };
      };
    };
  };
}

const publishedSchema: PublishedSchema = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../usage-limits.schema.json", import.meta.url)),
    "utf-8"
  )
);

describe("configuration parsing", () => {
  it("published schema matches provider-specific runtime fields", () => {
    const commonFields = Object.keys(
      publishedSchema.$defs.commonDisplayFields.properties
    ).toSorted();

    const providerFields = {
      kimi: Object.keys(publishedSchema.$defs.kimiProvider.properties).toSorted(),
      codex: Object.keys(
        publishedSchema.$defs.codexProvider.properties
      ).toSorted(),
      "opencode-go": Object.keys(
        publishedSchema.$defs.openCodeGoProvider.properties
      ).toSorted(),
      zai: Object.keys(publishedSchema.$defs.zaiProvider.properties).toSorted(),
    };

    expect(publishedSchema.properties.providers.properties).toStrictEqual({
      kimi: { $ref: "#/$defs/kimiProvider" },
      codex: { $ref: "#/$defs/codexProvider" },
      "opencode-go": { $ref: "#/$defs/openCodeGoProvider" },
      zai: { $ref: "#/$defs/zaiProvider" },
    });
    expect(providerFields.zai).toStrictEqual(
      [...commonFields, "apiKey", "authPath", "authorizationScheme"].toSorted()
    );
    expect(providerFields.kimi).toStrictEqual(
      [...commonFields, "apiKey", "authPath"].toSorted()
    );
    expect(providerFields.codex).toStrictEqual(
      [
        ...commonFields,
        "apiKey",
        "authPath",
        "authorizationScheme",
        "baseUrl",
      ].toSorted()
    );

    expect(providerFields["opencode-go"]).toStrictEqual(
      [...commonFields, "apiKey", "authPath", "baseUrl"].toSorted()
    );
  });

  it("defaults only omitted top-level fields and accepts $schema", () => {
    const result = parseUsageLimitsConfig({
      $schema: "https://example.com/usage-limits.schema.json",
      providers: {},
      refreshIntervalSeconds: 15,
      requestTimeoutMs: 1000,
      showErrors: false,
    });

    const success = Result.isSuccess(result) ? result.success : undefined;
    expect(Result.isSuccess(result)).toBeTruthy();
    expect(success).toStrictEqual({
      enabled: true,
      providers: {},
      refreshIntervalSeconds: 15,
      requestTimeoutMs: 1000,
      showErrors: false,
    });
  });

  it("parses every provider field and redacts API keys", () => {
    const result = parseUsageLimitsConfig({
      providers: {
        codex: {
          apiKey: "do-not-log",
          authPath: "~/.codex/auth.json",
          authorizationScheme: "bearer",
          baseUrl: "https://example.com",
          enabled: true,
          footerWindow: "weekly",
          label: "Work",
          showFooterBar: false,
          showSidebarBar: true,
          sidebarWindow: "weekly",
        },
        "opencode-go": {
          apiKey: "opencode-go-secret",
          authPath: "~/.config/opencode/auth.json",
          baseUrl: "https://opencode.ai/zen/go/v1",
          enabled: true,
          label: "GO",
        },
        zai: {
          apiKey: "zai-secret",
          authPath: "~/.config/opencode/auth.json",
          authorizationScheme: "raw",
          enabled: true,
          label: "ZAI",
        },
      },
    });

    const success = Result.isSuccess(result) ? result.success : undefined;
    const apiKey = success?.providers.codex?.apiKey;
    const openCodeGoApiKey = success?.providers["opencode-go"]?.apiKey;
    const zaiApiKey = success?.providers.zai?.apiKey;
    expect(Result.isSuccess(result)).toBeTruthy();
    expect([
      Redacted.isRedacted(apiKey),
      Redacted.isRedacted(openCodeGoApiKey),
      Redacted.isRedacted(zaiApiKey),
    ]).toStrictEqual([true, true, true]);
    expect(String(apiKey)).not.toContain("do-not-log");
    expect(success?.providers).toMatchObject({
      codex: {
        authPath: "~/.codex/auth.json",
        authorizationScheme: "bearer",
        baseUrl: "https://example.com",
        enabled: true,
        footerWindow: "weekly",
        label: "Work",
        showFooterBar: false,
        showSidebarBar: true,
        sidebarWindow: "weekly",
      },
      "opencode-go": {
        authPath: "~/.config/opencode/auth.json",
        baseUrl: "https://opencode.ai/zen/go/v1",
        enabled: true,
        label: "GO",
      },
      zai: {
        authPath: "~/.config/opencode/auth.json",
        authorizationScheme: "raw",
        enabled: true,
        label: "ZAI",
      },
    });
  });

  it.each([
    [{ enabled: "yes" }, "wrong boolean type"],
    [{ refreshIntervalSeconds: 14 }, "refresh minimum"],
    [{ refreshIntervalSeconds: Number.NaN }, "finite refresh"],
    [{ requestTimeoutMs: 999 }, "timeout minimum"],
    [{ providers: { codex: { authorizationScheme: "token" } } }, "enum"],
    [
      { providers: { zai: { baseUrl: "unsupported" } } },
      "unsupported provider field",
    ],
    [{ providers: { unknown: {} } }, "unknown provider"],
    [{ unknown: true }, "unknown top-level key"],
  ])("rejects %s (%s)", (input, _label) => {
    const result = parseUsageLimitsConfig(input);
    const failure = Result.isFailure(result) ? result.failure : undefined;
    expect(Result.isFailure(result)).toBeTruthy();
    expect(failure).toBeInstanceOf(ConfigDecodeError);
  });

  it("redacts malformed credential values from diagnostics", () => {
    const credential = { secret: "never-render-this" };

    const result = parseUsageLimitsConfig({
      providers: { zai: { apiKey: credential } },
    });

    expect(Result.isFailure(result)).toBeTruthy();
    const failure = Result.isFailure(result) ? result.failure : undefined;
    expect(String(failure?.cause)).not.toContain("never-render-this");
  });
});

describe("configuration loading", () => {
  afterEach(() => {
    readJsonFile.mockReset();
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["relative", "config/opencode"],
  ])("uses the fallback for %s XDG paths", (_label, value) => {
    const fallback = path.join(homedir(), ".fallback");

    expect(resolveXdgPath(value, fallback)).toBe(fallback);
  });

  it("accepts an absolute XDG path", () => {
    const absolute = path.join(homedir(), ".xdg");

    expect(resolveXdgPath(absolute, path.join(homedir(), ".fallback"))).toBe(
      absolute
    );
  });

  it("resolves platform-specific default OpenCode auth locations", () => {
    const home = path.join(path.sep, "users", "test");

    expect(
      defaultOpenCodeAuthPath("win32", undefined, "D:/AppData", home)
    ).toBe(path.join("D:/AppData", "opencode", "auth.json"));
    expect(defaultOpenCodeAuthPath("win32", undefined, undefined, home)).toBe(
      path.join(home, "AppData", "Local", "opencode", "auth.json")
    );
    expect(defaultOpenCodeAuthPath("linux", undefined, undefined, home)).toBe(
      path.join(home, ".local", "share", "opencode", "auth.json")
    );
    const xdgData = path.resolve(path.sep, "xdg", "data");
    expect(defaultOpenCodeAuthPath("linux", xdgData, undefined, home)).toBe(
      path.join(xdgData, "opencode", "auth.json")
    );
  });

  it("returns defaults when no user config exists", async () => {
    readJsonFile.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" })
    );

    const result = await loadConfig(readJsonFile);
    const success = Result.isSuccess(result) ? result.success : undefined;
    expect(Result.isSuccess(result)).toBeTruthy();
    expect(success?.refreshIntervalSeconds).toBe(300);
    expect(readJsonFile).toHaveBeenCalledWith(
      path.join(testXdgConfigHome, "opencode", "usage-limits.jsonc")
    );
  });

  it("returns typed read and JSONC decode failures", async () => {
    readJsonFile.mockRejectedValueOnce(new Error("permission denied"));
    const readResult = await loadConfig(readJsonFile);

    const readFailure = Result.isFailure(readResult)
      ? readResult.failure
      : undefined;

    expect(Result.isFailure(readResult)).toBeTruthy();
    expect(readFailure).toBeInstanceOf(ConfigReadError);

    readJsonFile.mockRejectedValueOnce(new SyntaxError("malformed"));
    const decodeResult = await loadConfig(readJsonFile);

    const decodeFailure = Result.isFailure(decodeResult)
      ? decodeResult.failure
      : undefined;

    expect(Result.isFailure(decodeResult)).toBeTruthy();
    expect(decodeFailure).toBeInstanceOf(ConfigDecodeError);
  });

  it("classifies non-Error loader failures as read errors", async () => {
    readJsonFile.mockRejectedValueOnce("unexpected config failure");
    const result = await loadConfig(readJsonFile);
    expect(Result.isFailure(result)).toBeTruthy();
    expect(
      Result.isFailure(result) ? result.failure : undefined
    ).toBeInstanceOf(ConfigReadError);
  });

  it("loads recognized auth fields as redacted values", async () => {
    readJsonFile.mockResolvedValueOnce({
      ignored: { value: true },
      openai: { access: "token", accountId: "account" },
    });

    const result = await loadOpenCodeAuth(readJsonFile);
    expect(Redacted.isRedacted(result.auth.openai?.access)).toBeTruthy();
    expect(String(result.auth.openai?.access)).not.toContain("token");
    expect(result.diagnostic).toBeUndefined();
    expect(readJsonFile).toHaveBeenCalledWith(
      path.join(testXdgDataHome, "opencode", "auth.json")
    );
  });

  it("treats absent or malformed auth as empty", async () => {
    readJsonFile.mockRejectedValueOnce(new Error("missing"));
    await expect(loadOpenCodeAuth(readJsonFile)).resolves.toMatchObject({
      auth: {},
      diagnostic: { kind: "auth-read" },
    });
  });

  it.each([
    [null, "OpenCode auth has an unsupported format"],
    [[], "OpenCode auth has an unsupported format"],
    [{ zai: null }, "Some OpenCode auth fields could not be read"],
    [{ zai: [] }, "Some OpenCode auth fields could not be read"],
  ])(
    "reports malformed auth format %p without credentials",
    async (input, message) => {
      readJsonFile.mockResolvedValueOnce(input);

      await expect(loadOpenCodeAuth(readJsonFile)).resolves.toStrictEqual({
        auth: {},
        diagnostic: { kind: "auth-decode", message },
      });
    }
  );

  it("classifies auth parse and filesystem read errors separately", async () => {
    readJsonFile.mockRejectedValueOnce(new SyntaxError("malformed"));
    await expect(loadOpenCodeAuth(readJsonFile)).resolves.toMatchObject({
      auth: {},
      diagnostic: {
        kind: "auth-decode",
        message: "OpenCode auth could not be parsed",
      },
    });

    readJsonFile.mockRejectedValueOnce(new Error("permission denied"));
    await expect(loadOpenCodeAuth(readJsonFile)).resolves.toMatchObject({
      auth: {},
      diagnostic: {
        kind: "auth-read",
        message: "OpenCode auth could not be read",
      },
    });

    readJsonFile.mockRejectedValueOnce("unexpected auth failure");
    await expect(loadOpenCodeAuth(readJsonFile)).resolves.toMatchObject({
      auth: {},
      diagnostic: {
        kind: "auth-read",
        message: "OpenCode auth could not be read",
      },
    });
  });

  it("classifies absent and malformed auth without exposing values", async () => {
    readJsonFile.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" })
    );
    await expect(loadOpenCodeAuth(readJsonFile)).resolves.toMatchObject({
      auth: {},
      diagnostic: { kind: "auth-missing" },
    });

    readJsonFile.mockResolvedValueOnce({
      zai: { apiKey: { secret: "do-not-log" }, key: "valid-key" },
    });
    const result = await loadOpenCodeAuth(readJsonFile);
    expect(credentialValue(result.auth.zai?.key)).toBe("valid-key");
    expect(result.diagnostic).toStrictEqual({
      kind: "auth-decode",
      message: "Some OpenCode auth fields could not be read",
    });
    expect(JSON.stringify(result.diagnostic)).not.toContain("do-not-log");
    expect(parseOpenCodeAuth({ openai: { access: 42 } })).toStrictEqual({});
  });

  it.each(["key", "apiKey"] as const)(
    "reports malformed direct auth field %s",
    async (field) => {
      readJsonFile.mockResolvedValueOnce({
        [field]: { secret: "do-not-log" },
      });

      const result = await loadOpenCodeAuth(readJsonFile);

      expect(result.auth).toStrictEqual({});
      expect(result.diagnostic).toStrictEqual({
        kind: "auth-decode",
        message: "Some OpenCode auth fields could not be read",
      });
      expect(JSON.stringify(result.diagnostic)).not.toContain("do-not-log");
    }
  );

  it("keeps direct legacy auth credentials", () => {
    const auth = parseOpenCodeAuth({
      apiKey: "direct-api-key",
      key: "direct-key",
    });

    expect(credentialValue(auth.apiKey)).toBe("direct-api-key");
    expect(credentialValue(auth.key)).toBe("direct-key");
  });

  it("keeps valid auth entries when another recognized entry is malformed", () => {
    const auth = parseOpenCodeAuth({
      "opencode-go": { key: "valid-go" },
      openai: { access: "valid-openai", accountId: "valid-account" },
      "zai-coding-plan": { key: 42 },
      zai: { key: "valid-zai" },
    });

    expect(credentialValue(auth.openai?.access)).toBe("valid-openai");
    expect(credentialValue(auth["opencode-go"]?.key)).toBe("valid-go");
    expect(credentialValue(auth.zai?.key)).toBe("valid-zai");
    expect(auth["zai-coding-plan"]).toBeUndefined();
  });

  it("keeps valid credential fields beside malformed sibling fields", () => {
    const auth = parseOpenCodeAuth({
      openai: {
        access: "valid-access",
        accountId: { invalid: true },
        ignored: "value",
      },
      zai: { apiKey: 42, ignored: "value", key: "valid-key" },
    });

    expect(credentialValue(auth.zai?.key)).toBe("valid-key");
    expect(auth.zai?.apiKey).toBeUndefined();
    expect(credentialValue(auth.openai?.access)).toBe("valid-access");
    expect(auth.openai?.accountId).toBeUndefined();
  });

  it("parses every recognized auth entry and ignores non-object input", () => {
    const auth = parseOpenCodeAuth({
      openai: { accountId: "account" },
      opencode: { key: "opencode" },
      "opencode-go": { key: "go" },
      zai: { key: "zai" },
      "zai-coding-plan": { key: "zai-plan" },
    });

    expect([
      credentialValue(auth.openai?.accountId),
      credentialValue(auth.opencode?.key),
      credentialValue(auth["opencode-go"]?.key),
      credentialValue(auth.zai?.key),
      credentialValue(auth["zai-coding-plan"]?.key),
    ]).toStrictEqual(["account", "opencode", "go", "zai", "zai-plan"]);
    expect(parseOpenCodeAuth(null)).toStrictEqual({});
  });

  it("rejects invalid and blank credentials at the adapter boundary", () => {
    expect(credentialValue(null)).toBeUndefined();
    expect(credentialValue(42)).toBeUndefined();
    expect(credentialValue("  \t ")).toBeUndefined();
    expect(credentialValue(Redacted.make("  secret  "))).toBe("secret");
  });
});
