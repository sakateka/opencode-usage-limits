import { Clock, Effect, Redacted, Result } from "effect";

import { MissingProviderCredentialsError, ProviderResponseDecodeError } from "@/errors.ts";
import { readProviderAuthFileCredential } from "@/providers/auth-file.ts";
import type { ProviderDefinition } from "@/providers/definition.ts";
import { ProviderEnvironment } from "@/providers/runtime/environment.ts";
import { ProviderHttpClient } from "@/providers/runtime/http.ts";
import { ProviderRuntimeLive } from "@/providers/runtime/index.ts";
import type { KimiProviderConfig, OpenCodeAuth, UsageWindow } from "@/types.ts";
import { parseUsagePercentage, percentageQuota, resetInstantOrNull } from "@/usage.ts";
import { isRecord } from "@/utils.ts";
import type { JsonObject, JsonValue } from "@/utils.ts";

// Official Kimi Code CLI: ui/shell/usage.py uses <coding base URL>/usages.
// The global coding base URL is documented at kimi.com/code/docs/en/.
const USAGE_URL = "https://api.kimi.ai/coding/v1/usages";

const numeric = (value: JsonValue): number | undefined => {
  if (typeof value !== "number" &&
      !(typeof value === "string" && /^\d+(?:\.\d+)?$/u.test(value))) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

const windowFrom = (
  value: JsonValue,
  kind: UsageWindow["kind"],
  label: string,
  ratio: boolean,
): UsageWindow | null => {
  if (!isRecord(value)) return null;
  let usedPercent: number | undefined;
  if (ratio) {
    const usedRatio = numeric(value.used_ratio);
    if (usedRatio !== undefined) usedPercent = usedRatio * 100;
  } else {
    const total = numeric(value.limit);
    const used = numeric(value.used);
    const remaining = numeric(value.remaining);
    if (total !== undefined && total > 0) {
      if (used !== undefined) usedPercent = used / total * 100;
      else if (remaining !== undefined && remaining <= total) {
        usedPercent = (total - remaining) / total * 100;
      }
    }
  }
  if (usedPercent === undefined || !Number.isFinite(usedPercent)) return null;
  // The provider can report an exceeded quota; show a full bar rather than fail.
  const percentage = parseUsagePercentage(Math.min(usedPercent, 100));
  if (Result.isFailure(percentage)) return null;
  const reset = value.reset_time ?? value.resetTime;
  return {
    kind,
    label,
    quota: percentageQuota(percentage.success),
    resetsAt: resetInstantOrNull(typeof reset === "string" ? new Date(reset) : null),
  };
};

const parseWindows = (payload: JsonValue): UsageWindow[] => {
  if (!isRecord(payload)) return [];
  const windows: UsageWindow[] = [];
  const add = (window: UsageWindow | null) => {
    if (window && !windows.some(w => w.kind === window.kind && w.label === window.label)) {
      windows.push(window);
    }
  };

  if (isRecord(payload.usages)) {
    add(windowFrom(payload.usages.limit_5h, "rolling", "5h", true));
    add(windowFrom(payload.usages.limit_month_total, "monthly", "monthly", true));
    add(windowFrom(payload.usages.limit_month_code, "monthly", "monthly code", true));
  }
  // Older official clients expose a weekly summary and window/detail entries.
  add(windowFrom(payload.usage, "weekly", "weekly", false));
  if (Array.isArray(payload.limits)) {
    for (const limit of payload.limits.slice(0, 16)) {
      if (!isRecord(limit) || !isRecord(limit.window)) continue;
      const duration = numeric(limit.window.duration);
      const unit = limit.window.timeUnit;
      if ((duration === 300 && unit === "TIME_UNIT_MINUTE") ||
          (duration === 5 && unit === "TIME_UNIT_HOUR")) {
        add(windowFrom(limit.detail ?? limit, "rolling", "5h", false));
      }
    }
  }
  return windows;
};

const keyFromAuth = (
  value: JsonObject,
  credential: (input: JsonValue) => Redacted.Redacted<string> | undefined,
) => {
  const entry = value["kimi-code-plan-global"];
  return isRecord(entry)
    ? credential(entry.key) ?? credential(entry.apiKey)
    : credential(value.key) ?? credential(value.apiKey);
};

const fetchKimiUsageEffect: ProviderDefinition<"kimi">["fetch"] = (
  config, auth, timeoutMs,
) => Effect.gen(function* () {
  const environment = yield* ProviderEnvironment;
  const http = yield* ProviderHttpClient;
  const key = (yield* readProviderAuthFileCredential(config?.authPath, "kimi", keyFromAuth))
    ?? (isRecord(auth) ? keyFromAuth(auth, environment.credential) : undefined)
    ?? environment.resolveCredential(config?.apiKey);
  if (!key) {
    return yield* new MissingProviderCredentialsError({
      operation: "fetch-usage", providerID: "kimi",
    });
  }
  const payload = yield* http.requestJson({
    url: USAGE_URL,
    method: "GET",
    redirect: "error",
    headers: { Authorization: `Bearer ${Redacted.value(key)}`, Accept: "application/json" },
    providerID: "kimi",
    timeoutMs,
  });
  const windows = parseWindows(payload);
  if (windows.length === 0) {
    return yield* new ProviderResponseDecodeError({
      cause: "schema", operation: "decode-response", providerID: "kimi",
    });
  }
  return {
    id: "kimi" as const,
    label: config?.label ?? "Kimi Code",
    capturedAt: new Date(yield* Clock.currentTimeMillis),
    windows,
  };
});

export const fetchKimiUsage = (
  config: KimiProviderConfig | undefined,
  auth: OpenCodeAuth,
  timeoutMs: number,
) => Effect.runPromise(fetchKimiUsageEffect(config, auth, timeoutMs).pipe(
  Effect.provide(ProviderRuntimeLive),
));

export const kimiProvider = {
  id: "kimi",
  defaultLabel: "Kimi Code",
  displayOrder: 6,
  footerWindowKind: "rolling",
  openCodeProviderIDs: ["kimi-code-plan-global"],
  fetch: fetchKimiUsageEffect,
} as const satisfies ProviderDefinition<"kimi">;
