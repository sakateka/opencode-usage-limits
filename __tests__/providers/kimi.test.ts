import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Redacted, Result } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { credentialValue, parseOpenCodeAuth, parseUsageLimitsConfig } from "@/config-schema.ts";
import { pluginProviderForOpenCode } from "@/providers/index.ts";
import { fetchKimiUsage } from "@/providers/kimi.ts";

import { installFetchMock, resetFetchMock } from "./helpers.ts";

const auth = { "kimi-code-plan-global": { key: "saved-key" } };
// Synthetic fixtures, not snapshots of a subscriber's account.
const reset = "2030-01-01T00:00:00Z";
const modernPayload = {
  // Rounded legacy data must not override precise modern ratios.
  limits: [{ window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
    detail: { limit: "100", used: "26", remaining: "74", resetTime: reset } }],
  usages: {
    limit_5h: { used_ratio: 0.254, reset_time: reset },
    limit_month_total: { used_ratio: 0.4, reset_time: reset },
    limit_month_code: { used_ratio: 0.4, reset_time: reset },
  },
};

describe("Kimi Code global subscription", () => {
  afterEach(() => { resetFetchMock(); vi.unstubAllEnvs(); });

  it("fetches precise rolling and monthly quotas only from the official host", async () => {
    const fetch = installFetchMock(Response.json(modernPayload));
    const usage = await fetchKimiUsage(undefined, auth, 1000);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "https://api.kimi.ai/coding/v1/usages",
      expect.objectContaining({
        method: "GET", redirect: "error", signal: expect.any(AbortSignal),
        headers: { Authorization: "Bearer saved-key", Accept: "application/json" },
      }),
    );
    expect(usage.id).toBe("kimi");
    expect(usage.label).toBe("Kimi Code");
    expect(usage.windows.map(w => [w.kind, w.label])).toStrictEqual([
      ["rolling", "5h"], ["monthly", "monthly"], ["monthly", "monthly code"],
    ]);
    expect(usage.windows[0]?.quota).toMatchObject({ usedPercent: 25.4, remainingPercent: 74.6 });
    expect(usage.windows[1]?.quota).toMatchObject({ usedPercent: 40 });
    expect(usage.windows.every(w => w.resetsAt?.getTime() === Date.parse(reset))).toBe(true);
  });

  it("supports older weekly summaries and remaining-only rolling limits", async () => {
    installFetchMock(Response.json({
      usage: { limit: "100", used: "40", resetTime: reset },
      limits: [{ window: { duration: 5, timeUnit: "TIME_UNIT_HOUR" },
        detail: { limit: "100", remaining: "70", resetTime: reset } }],
    }));
    const usage = await fetchKimiUsage(undefined, auth, 1000);
    expect(usage.windows).toMatchObject([
      { kind: "weekly", quota: { usedPercent: 40 } },
      { kind: "rolling", quota: { usedPercent: 30 } },
    ]);
  });

  it.each([0, 1, 1.2])("handles a used ratio of %s", async (ratio) => {
    installFetchMock(Response.json({ usages: { limit_5h: { used_ratio: ratio } } }));
    const usage = await fetchKimiUsage(undefined, auth, 1000);
    expect(usage.windows[0]?.quota).toMatchObject({ usedPercent: Math.min(ratio * 100, 100) });
    expect(usage.windows[0]?.resetsAt).toBeNull();
  });

  it.each([null, {}, { error: "secret-error-body" }, { usages: { limit_5h: { used_ratio: -1 } } },
    { usages: { limit_5h: { used_ratio: "invalid" } } },
    { usage: { limit: "100" } }, { usage: { limit: "0", used: "0" } },
    { limits: [{ window: { duration: 1, timeUnit: "UNKNOWN" }, detail: { limit: 100, used: 1 } }] },
  ])("rejects unusable quota payload %j", async (payload) => {
    installFetchMock(Response.json(payload));
    await expect(fetchKimiUsage(undefined, auth, 1000)).rejects.toMatchObject({
      _tag: "ProviderResponseDecodeError", providerID: "kimi", cause: "schema",
    });
  });

  it("falls back to legacy data if modern ratios are invalid", async () => {
    installFetchMock(Response.json({ ...modernPayload,
      usages: { limit_5h: { used_ratio: "invalid" } },
    }));
    const usage = await fetchKimiUsage(undefined, auth, 1000);
    expect(usage.windows[0]?.quota).toMatchObject({ usedPercent: 26 });
  });

  it("does not infer zero usage from missing counts", async () => {
    installFetchMock(Response.json({ limits: [{
      window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
      detail: { limit: 100 },
    }] }));
    await expect(fetchKimiUsage(undefined, auth, 1000)).rejects.toMatchObject({
      _tag: "ProviderResponseDecodeError",
    });
  });

  it("does not use another provider's credential", async () => {
    const fetch = installFetchMock(Response.json(modernPayload));
    await expect(fetchKimiUsage(undefined, { zai: { key: "other-key" } }, 1000))
      .rejects.toMatchObject({ _tag: "MissingProviderCredentialsError", providerID: "kimi" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses redacted configuration and environment fallback credentials", async () => {
    vi.stubEnv("TEST_KIMI_KEY", "env-key");
    const fetch = installFetchMock(Response.json(modernPayload));
    const result = parseUsageLimitsConfig({ providers: { kimi: { apiKey: "{env:TEST_KIMI_KEY}" } } });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) throw result.failure;
    expect(Redacted.isRedacted(result.success.providers.kimi?.apiKey)).toBe(true);
    await fetchKimiUsage(result.success.providers.kimi, {}, 1000);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer env-key" });
  });

  it("prefers the saved credential over the configured fallback", async () => {
    const fetch = installFetchMock(Response.json(modernPayload));
    await fetchKimiUsage({ apiKey: "fallback-key", label: "Kimi" }, auth, 1000);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer saved-key" });
  });

  it("uses an explicitly configured auth file", async () => {
    const authPath = path.join(tmpdir(), `kimi-quota-${crypto.randomUUID()}.json`);
    await writeFile(authPath, JSON.stringify({ "kimi-code-plan-global": { key: "file-key" } }));
    try {
      const fetch = installFetchMock(Response.json(modernPayload));
      await fetchKimiUsage({ authPath }, auth, 1000);
      expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer file-key" });
    } finally { await rm(authPath, { force: true }); }
  });

  it("preserves safe HTTP errors without exposing credentials or response bodies", async () => {
    installFetchMock(new Response("secret-error-body", { status: 401 }));
    try { await fetchKimiUsage(undefined, auth, 1000); throw new Error("expected failure"); }
    catch (error) {
      expect(error).toMatchObject({ _tag: "ProviderTransportError", status: 401 });
      expect(JSON.stringify(error)).not.toMatch(/saved-key|secret-error-body/u);
    }
  });

  it("does not follow redirect responses", async () => {
    const fetch = installFetchMock(new Response(null, { status: 302, headers: { Location: "https://example.com" } }));
    await expect(fetchKimiUsage(undefined, auth, 1000)).rejects.toMatchObject({ status: 302 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("parses only the supported auth entry and maps the global provider to the footer", () => {
    const parsed = parseOpenCodeAuth({ ...auth, "unrelated-kimi": { key: "other" } });
    expect(credentialValue(parsed["kimi-code-plan-global"]?.key)).toBe("saved-key");
    expect(pluginProviderForOpenCode("kimi-code-plan-global")).toBe("kimi");
    expect(pluginProviderForOpenCode("moonshotai")).toBeNull();
    expect(Result.isFailure(parseUsageLimitsConfig({
      providers: { kimi: { baseUrl: "https://example.com" } },
    }))).toBe(true);
  });
});
