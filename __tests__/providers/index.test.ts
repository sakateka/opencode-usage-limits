import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  fetchProvider,
  fetchProviderEffect,
  getProviderConfigs,
} from "@/providers.ts";
import { codexProvider } from "@/providers/codex.ts";
import type { ProviderDefinition } from "@/providers/definition.ts";
import {
  defaultLabelFor,
  pluginProviderForOpenCode,
  PROVIDER_ORDER,
  PROVIDER_REGISTRY,
  PROVIDERS,
} from "@/providers/index.ts";
import { ProviderRuntimeLive } from "@/providers/runtime/index.ts";
import type { ProviderUsage } from "@/types.ts";

import { installFetchMock, resetFetchMock } from "./helpers.ts";

describe("provider manifest", () => {
  afterEach(resetFetchMock);

  it("binds each fetch result to its definition ID", () => {
    const definition: ProviderDefinition<"codex"> = codexProvider;
    const fetch: typeof definition.fetch = definition.fetch;

    expect(fetch).toBe(codexProvider.fetch);
  });

  it("defines every provider in display order", () => {
    expect(PROVIDERS.map((provider) => provider.id)).toStrictEqual([
      ...PROVIDER_ORDER,
    ]);

    for (const id of PROVIDER_ORDER) {
      expect(PROVIDER_REGISTRY[id].id).toBe(id);
      expect(defaultLabelFor(id)).toStrictEqual(
        PROVIDER_REGISTRY[id].defaultLabel
      );
    }
  });

  it("maps OpenCode session providers to plugin providers", () => {
    expect([
      ["openai", pluginProviderForOpenCode("openai")],
      ["zai-coding-plan", pluginProviderForOpenCode("zai-coding-plan")],
      ["opencode-go", pluginProviderForOpenCode("opencode-go")],
      ["anthropic", pluginProviderForOpenCode("anthropic")],
    ]).toStrictEqual([
      ["openai", "codex"],
      ["zai-coding-plan", "zai"],
      ["opencode-go", "opencode-go"],
      ["anthropic", null],
    ]);
  });

  it("returns enabled providers in display order", () => {
    expect(
      getProviderConfigs({
        enabled: true,
        providers: {
          codex: { enabled: true, label: "Codex" },
          "opencode-go": { enabled: true, label: "OpenCode GO" },
          zai: { enabled: false, label: "ZAI" },
        },
        refreshIntervalSeconds: 60,
        requestTimeoutMs: 1000,
        showErrors: true,
      })
    ).toStrictEqual([
      ["codex", { enabled: true, label: "Codex" }],
      ["opencode-go", { enabled: true, label: "OpenCode GO" }],
    ]);
  });

  it("dispatches provider fetches by id", async () => {
    installFetchMock(
      Response.json({
        plan_type: "plus",
        rate_limit: { primary_window: { used_percent: 0 } },
        rate_limit_reset_credits: { available_count: 3 },
      })
    );

    const result: Promise<ProviderUsage<"codex">> = Effect.runPromise(
      fetchProviderEffect(
        "codex",
        { enabled: true },
        { openai: { access: "token", accountId: "account" } },
        1000
      ).pipe(Effect.provide(ProviderRuntimeLive))
    );

    await expect(result).resolves.toMatchObject({ id: "codex" });
  });

  it("dispatches ZAI provider fetches through the registry definition", async () => {
    const fetchMock = installFetchMock(
      Response.json({
        data: {
          limits: [
            { type: "TOKENS_LIMIT", percentage: 40, nextResetTime: 0 },
            { type: "TIME_LIMIT", usage: 300 },
          ],
        },
      })
    );

    const usage = await Effect.runPromise(
      fetchProviderEffect(
        "zai",
        { apiKey: "zai-key" },
        {},
        1000
      ).pipe(Effect.provide(ProviderRuntimeLive))
    );

    expect(fetchMock.mock.calls[0]).toMatchObject([
      "https://api.z.ai/api/monitor/usage/quota/limit",
      { headers: { Authorization: "zai-key" } },
    ]);
    expect(usage).toMatchObject({
      id: "zai",
      tierName: "Pro",
    });
  });

  it("rejects unknown provider ids asynchronously", async () => {
    const unknownEffect = fetchProviderEffect("unknown", undefined, {}, 1000);
    expect(unknownEffect).toBeDefined();
    await expect(
      Effect.runPromise(unknownEffect.pipe(Effect.provide(ProviderRuntimeLive)))
    ).rejects.toThrow("unknown provider: unknown");

    const unknownPromise = fetchProvider("unknown", undefined, {}, 1000);
    await expect(unknownPromise).rejects.toThrow("unknown provider: unknown");
  });
});
