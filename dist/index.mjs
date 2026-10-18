import { Plugin } from "@opencode/plugin/tui";
import { Cause, Clock, Context, Effect, Fiber, Layer, Queue, Redacted, Result, Schema } from "effect";
import { For, Show, createEffect, createMemo, createRoot, createSignal } from "solid-js";
import { Fragment, jsx, jsxs } from "@opentui/solid/jsx-runtime";
import { homedir } from "node:os";
import path from "node:path";
import { open, readFile } from "node:fs/promises";
//#region src/usage.ts
/** Schema for finite percentages in the inclusive range `0..100`. */
const PercentageSchema = Schema.Finite.check(Schema.isBetween({
	maximum: 100,
	minimum: 0
})).pipe(Schema.brand("Percentage"));
/** Schema for finite, non-negative quota counts. */
const QuotaCountSchema = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand("QuotaCount"));
const BalanceAmountSchema = Schema.Finite.pipe(Schema.brand("BalanceAmount"));
/** Schema for valid absolute reset instants. */
const ResetInstantSchema = Schema.Date;
const parsePercentage = Schema.decodeUnknownResult(PercentageSchema);
const parseQuotaCount = Schema.decodeUnknownResult(QuotaCountSchema);
Schema.decodeUnknownResult(BalanceAmountSchema);
const parseResetInstant = Schema.decodeUnknownResult(ResetInstantSchema);
/**
* Decodes an unknown value as a finite percentage in the inclusive range `0..100`.
*
* @param value - Value supplied by a provider response.
* @returns A validated percentage or a schema decoding failure.
*/
const parseUsagePercentage = (value) => parsePercentage(value);
/**
* Decodes an unknown value as a finite, non-negative quota count.
*
* @param value - Value supplied by a provider response.
* @returns A validated count or a schema decoding failure.
*/
/**
* Decodes an unknown value as a finite, non-negative quota count.
*
* @param value - Value supplied by a provider response.
* @returns A validated count or a schema decoding failure.
*/
const parseUsageCount = (value) => parseQuotaCount(value);
/** Returns a valid reset instant or `null` for absent/invalid provider values. */
/**
* Decodes a reset instant, returning `null` when the value is invalid.
*
* @param value - Date or encoded date supplied by a provider response.
* @returns The validated instant, or `null` if it cannot be decoded.
*/
const resetInstantOrNull = (value) => {
	const result = parseResetInstant(value);
	return Result.isFailure(result) ? null : result.success;
};
/** Creates a percentage quota from an already normalized used percentage. */
/**
* Creates a percentage quota and derives its remaining percentage.
*
* @param usedPercent - Validated percentage already consumed.
* @returns A percentage quota with complementary remaining usage.
*/
const percentageQuota = (usedPercent) => {
	const parsedUsed = PercentageSchema.make(usedPercent);
	return {
		_tag: "Percentage",
		remainingPercent: PercentageSchema.make(100 - parsedUsed),
		usedPercent: parsedUsed
	};
};
/** Creates a count quota with its normalized percentage projection. */
/**
* Creates a count quota with a percentage projection.
*
* @param current - Validated amount consumed so far.
* @param total - Validated quota capacity.
* @param usedPercent - Validated percentage already consumed.
* @returns A count quota containing counts and percentage values.
* @throws {RangeError} When `current` exceeds `total`.
*/
const countQuota = (current, total, usedPercent, unit) => {
	const parsedCurrent = QuotaCountSchema.make(current);
	const parsedTotal = QuotaCountSchema.make(total);
	const parsedUsed = PercentageSchema.make(usedPercent);
	if (parsedCurrent > parsedTotal) throw new RangeError("quota current count cannot exceed total count");
	const quota = {
		_tag: "Count",
		current: parsedCurrent,
		remainingPercent: PercentageSchema.make(100 - parsedUsed),
		total: parsedTotal,
		usedPercent: parsedUsed
	};
	return unit === void 0 ? quota : {
		...quota,
		unit: Schema.String.make(unit)
	};
};
/** Quota form used when a provider cannot report meaningful usage. */
/** Quota sentinel for providers that cannot report meaningful usage. */
const unknownQuota = { _tag: "Unknown" };
/**
* Gets the percentage consumed by a quota when it reports consumption.
*
* @param quota - Normalized quota representation.
* @returns The used percentage, or `null` for balances and unknown quotas.
*/
const quotaUsedPercent = (quota) => quota._tag === "Percentage" || quota._tag === "Count" ? quota.usedPercent : null;
//#endregion
//#region src/format.ts
/**
* Formats a positive duration in seconds into the compact label used by the TUI.
*
* Values that are missing, invalid, or already elapsed are displayed as `now`.
* Positive values are rounded up to the next minute so near-future resets never
* appear as zero minutes remaining.
*
* @param seconds - Duration, in seconds, until the event occurs.
* @returns A short human-readable duration such as `3m`, `2h 15m`, or `1d 4h`.
*/
const duration = (seconds) => {
	if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "now";
	const minutes = Math.ceil(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const remainder = minutes % 60;
	if (hours < 24) {
		if (remainder === 0) return `${hours}h`;
		if (remainder === 30) return `${hours}.5h`;
		return `${hours}h ${remainder}m`;
	}
	const days = Math.floor(hours / 24);
	const hourRemainder = hours % 24;
	return hourRemainder === 0 ? `${days}d` : `${days}d ${hourRemainder}h`;
};
/**
* Formats a nullable usage percentage for display.
*
* @param value - The percentage to render, or `null` when the provider did not
*   report a percentage.
* @returns A rounded usage string, or `? used` when usage is unknown.
*/
const formatPercent = (value) => value === null ? "?" : `${Math.round(value)}%`;
const CURRENCY_SYMBOLS = /* @__PURE__ */ new Map([
	["CNY", "¥"],
	["EUR", "€"],
	["GBP", "£"],
	["JPY", "¥"],
	["KRW", "₩"],
	["USD", "$"]
]);
/**
* Formats a remaining balance amount without implying a percentage or total.
*
* @param quota - The remaining balance to render.
* @returns A concise amount followed by `remaining`.
*/
const formatBalance = (quota) => {
	const symbol = CURRENCY_SYMBOLS.get(quota.unit.toUpperCase());
	const sign = quota.remaining < 0 ? "-" : "";
	const rounded = symbol ? Math.abs(quota.remaining).toFixed(2) : "";
	const displayAmount = symbol && quota.remaining !== 0 && Number(rounded) === 0 ? "<0.01" : rounded;
	return `${symbol ? `${sign}${symbol}${displayAmount}` : `${quota.remaining} ${quota.unit}`} remaining`;
};
/** Formats an explicitly-unitized count quota without losing its unit. */
const formatCountQuota = (quota) => {
	const symbol = CURRENCY_SYMBOLS.get(quota.unit?.toUpperCase() ?? "");
	const amount = (value) => symbol ? `${symbol}${value.toFixed(2)}` : `${value} ${quota.unit}`;
	return `${amount(quota.current)} / ${amount(quota.total)} used`;
};
const formatQuotaText = (quota, appendUsedSuffix = false) => {
	if (quota._tag === "Balance") return formatBalance(quota);
	if (quota._tag === "Count" && quota.unit) return formatCountQuota(quota);
	const text = formatPercent(quotaUsedPercent(quota));
	return appendUsedSuffix ? `${text} used` : text;
};
/**
* Builds the compact prompt-footer text for the active provider's primary window.
*
* @param window - The active provider usage window to summarize.
* @returns A compact quota label such as `daily 42%` or `$12.34 remaining`.
*/
const bottomWindowMainText = (window) => `${window.label} ${formatQuotaText(window.quota)}`;
/**
* Formats the reset suffix for a usage window.
*
* @param window - The usage window whose reset time should be rendered.
* @returns A leading-space suffix such as ` resets 12m`, or an empty string when
*   the provider did not report a reset countdown.
*/
const windowResetText = (window, now = /* @__PURE__ */ new Date()) => window.resetsAt === null ? "" : ` · ${duration(Math.ceil((window.resetsAt.getTime() - now.getTime()) / 1e3))}`;
/**
* Renders a Unicode block progress bar for usage percentage.
*
* @param usedPercent - Percentage consumed, or `null` when unknown.
* @param width - Total width of the bar in characters (default 12).
* @returns A string of filled (█) and empty (░) blocks.
*/
const percentBar = (usedPercent, width = 12) => {
	if (usedPercent === null) return `[${"░".repeat(width)}]`;
	const ratio = usedPercent / 100;
	let filled = Math.round(ratio * width);
	if (usedPercent > 0 && filled === 0) filled = 1;
	filled = Math.max(0, Math.min(width, filled));
	return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
};
/**
* Formats a Date as HH:MM (24-hour, zero-padded).
*
* @param date - The date to format.
* @returns A time string such as `14:32`.
*/
const formatTimestamp = (date) => {
	return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
};
/**
* Formats the absolute reset time for a usage window.
*
* @param window - The usage window whose reset time should be rendered.
* @returns A leading-space suffix such as ` 23:15`, or an empty string when
*   the provider did not report a reset time.
*/
const windowResetTime = (window) => window.resetsAt === null ? "" : ` ${formatTimestamp(window.resetsAt)}`;
/**
* Converts a provider-reported rolling-window size into a stable display label.
*
* Provider APIs can return slightly imprecise window lengths, so expected
* windows are matched within a 5% tolerance before falling back to the caller's
* label.
*
* @param seconds - The provider-reported limit window length in seconds.
* @param fallback - Label to use when the window does not match a known size.
* @returns A normalized label such as `5h`, `daily`, `weekly`, or `monthly`.
*/
const limitLabelForWindow = (seconds, fallback) => {
	const minutes = Math.ceil(seconds / 60);
	const roughly = (expected) => minutes >= expected * .95 && minutes <= expected * 1.05;
	const day = 1440;
	if (roughly(300)) return "5h";
	if (roughly(day)) return "daily";
	if (roughly(7 * day)) return "weekly";
	if (roughly(30 * day)) return "monthly";
	return fallback;
};
//#endregion
//#region src/components.tsx
/** Local boundary for v2 theme data while the v2 plugin package is unavailable. */
const isV2Theme = (theme) => typeof theme.text === "object" && theme.text !== null && "feedback" in theme.text;
const resolveTheme = (theme) => {
	if (!isV2Theme(theme)) return {
		error: theme.error,
		subdued: theme.textMuted,
		success: theme.success,
		text: theme.text,
		warning: theme.warning
	};
	return {
		error: theme.text.feedback.error.default,
		subdued: theme.text.subdued,
		success: theme.text.feedback.success.default,
		text: theme.text.default,
		warning: theme.text.feedback.warning.default
	};
};
const dotColor = (usedPercent, theme) => {
	if (usedPercent === null) return theme.subdued;
	if (usedPercent >= 90) return theme.error;
	if (usedPercent >= 70) return theme.warning;
	return theme.success;
};
const UsageWindowRows = (props) => /* @__PURE__ */ jsx(For, {
	each: props.windows,
	children: (window) => {
		const usedPercent = quotaUsedPercent(window.quota);
		const showBar = props.showBar && window.quota._tag !== "Balance";
		const quotaText = formatQuotaText(window.quota, true);
		return /* @__PURE__ */ jsxs("box", {
			flexDirection: "column",
			children: [/* @__PURE__ */ jsxs("text", { children: [
				/* @__PURE__ */ jsx("span", {
					style: { fg: props.theme.subdued },
					children: "  "
				}),
				/* @__PURE__ */ jsx("span", {
					style: { fg: props.theme.text },
					children: /* @__PURE__ */ jsx("b", { children: window.label })
				}),
				/* @__PURE__ */ jsxs("span", {
					style: { fg: props.theme.subdued },
					children: [windowResetText(window), windowResetTime(window)]
				})
			] }), /* @__PURE__ */ jsxs("text", { children: [
				/* @__PURE__ */ jsx("span", {
					style: { fg: props.theme.subdued },
					children: "  "
				}),
				showBar ? /* @__PURE__ */ jsx("span", {
					style: { fg: dotColor(usedPercent, props.theme) },
					children: percentBar(usedPercent, 12)
				}) : null,
				/* @__PURE__ */ jsxs("span", {
					style: { fg: dotColor(usedPercent, props.theme) },
					children: [" ", quotaText]
				})
			] })]
		});
	}
});
/**
* Determines whether a provider state has visible sidebar content.
*
* @param state - Current state of one provider.
* @param showErrors - Whether provider errors should be displayed.
* @returns `true` when usage or a permitted error should be rendered.
*/
const shouldRenderProviderState = (state, showErrors) => {
	if (state.status === "disabled") return false;
	if (state.status !== "error") return true;
	if (state.previous) return true;
	return showErrors && state.errorKind !== "missing_credentials";
};
/**
* Renders provider usage, diagnostics, stale state, and refresh time in the sidebar.
*
* @param props - Provider snapshots and visual preferences for the panel.
* @returns The sidebar panel, or `null` when there is nothing to display.
*/
const UsageLimitsPanel = (props) => {
	const colors = resolveTheme(props.theme);
	const displayConfigFor = (state) => props.providerDisplays[state.id] ?? {
		footerWindow: "auto",
		showFooterBar: true,
		showSidebarBar: true,
		sidebarWindow: "all"
	};
	const filteredWindowsFor = (state, windows) => {
		const sidebarWindow = displayConfigFor(state).sidebarWindow;
		return sidebarWindow === "all" ? [...windows] : windows.filter((window) => window.kind === sidebarWindow || sidebarWindow === "rolling" && window.label === "5h");
	};
	const visibleStates = createMemo(() => props.states.filter((state) => {
		if (!shouldRenderProviderState(state, props.showErrors)) return false;
		if (state.status === "ready") return filteredWindowsFor(state, state.data.windows).length > 0;
		if (state.status === "error" && state.previous) return filteredWindowsFor(state, state.previous.windows).length > 0;
		return true;
	}));
	const diagnostics = props.diagnostics ?? [];
	if (visibleStates().length === 0 && diagnostics.length === 0) return null;
	return /* @__PURE__ */ jsxs("box", {
		flexDirection: "column",
		children: [
			/* @__PURE__ */ jsx("text", {
				fg: colors.text,
				children: /* @__PURE__ */ jsx("b", { children: "Usage Limits" })
			}),
			/* @__PURE__ */ jsx(For, {
				each: diagnostics,
				children: (diagnostic) => /* @__PURE__ */ jsx("text", {
					fg: colors.error,
					children: diagnostic.message
				})
			}),
			/* @__PURE__ */ jsx(For, {
				each: visibleStates(),
				children: (state) => {
					let tierName;
					if (state.status === "ready") ({tierName} = state.data);
					else if (state.status === "error" && state.previous) ({tierName} = state.previous);
					const isStale = state.status === "ready" && state.stale;
					const isCached = state.status === "error" && state.previous !== void 0;
					return /* @__PURE__ */ jsxs("box", {
						flexDirection: "column",
						children: [
							/* @__PURE__ */ jsxs("text", {
								fg: colors.text,
								children: [
									state.label,
									tierName ? /* @__PURE__ */ jsxs("span", {
										style: { fg: colors.subdued },
										children: [
											" [",
											tierName,
											"]"
										]
									}) : null,
									isStale ? /* @__PURE__ */ jsx("span", {
										style: { fg: colors.warning },
										children: " stale"
									}) : null,
									isCached ? /* @__PURE__ */ jsx("span", {
										style: { fg: colors.warning },
										children: " cached"
									}) : null
								]
							}),
							state.status === "loading" ? /* @__PURE__ */ jsx("text", {
								fg: colors.subdued,
								children: " loading..."
							}) : null,
							state.status === "ready" ? /* @__PURE__ */ jsx(UsageWindowRows, {
								showBar: displayConfigFor(state).showSidebarBar,
								theme: colors,
								windows: filteredWindowsFor(state, state.data.windows)
							}) : null,
							state.status === "error" && state.previous ? /* @__PURE__ */ jsx(UsageWindowRows, {
								showBar: displayConfigFor(state).showSidebarBar,
								theme: colors,
								windows: filteredWindowsFor(state, state.previous.windows)
							}) : null,
							state.status === "error" && props.showErrors ? /* @__PURE__ */ jsxs("text", {
								fg: colors.error,
								children: [" ", state.message]
							}) : null
						]
					});
				}
			}),
			props.lastRefreshAt ? /* @__PURE__ */ jsxs("text", {
				fg: colors.subdued,
				children: ["Updated ", formatTimestamp(props.lastRefreshAt)]
			}) : null
		]
	});
};
/**
* Renders the compact active-provider usage indicator in the prompt footer.
*
* @param props - Active usage window and active TUI theme.
* @returns Solid/OpenTUI JSX for the prompt footer slot.
*/
const BottomUsage = (props) => {
	const colors = resolveTheme(props.theme);
	return /* @__PURE__ */ jsx(Show, {
		when: props.window,
		keyed: true,
		children: (window) => {
			const usedPercent = quotaUsedPercent(window.quota);
			return /* @__PURE__ */ jsxs("text", { children: [
				props.showBar && window.quota._tag !== "Balance" ? /* @__PURE__ */ jsx("span", {
					style: { fg: dotColor(usedPercent, colors) },
					children: percentBar(usedPercent, 8)
				}) : null,
				/* @__PURE__ */ jsxs("span", {
					style: { fg: colors.text },
					children: [" ", bottomWindowMainText(window)]
				}),
				/* @__PURE__ */ jsx("span", {
					style: { fg: colors.subdued },
					children: windowResetText(window)
				})
			] });
		}
	});
};
//#endregion
//#region src/errors-shared.ts
/** Factory for schema-validated tagged error classes used at plugin boundaries. */
const schemaTaggedError = Schema.TaggedError;
/** Schema for the provider identifiers accepted in structured errors. */
const ProviderIDSchema = Schema.Literals([
	"codex",
	"zai",
	"opencode-go",
	"kimi"
]);
/** Safe, user-facing missing-credential message for each provider. */
const credentialMessages = {
	kimi: "missing Kimi Code key",
	codex: "missing Codex auth",
	"opencode-go": "missing OpenCode GO key",
	zai: "missing ZAI key"
};
/** Schema for operations that can fail at provider boundaries. */
const ProviderOperationSchema = Schema.Literals([
	"decode-response",
	"fetch-usage",
	"read-auth"
]);
/** Schema for finite numeric values greater than or equal to zero. */
const NonNegativeFiniteSchema = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
/** Common allow-listed failure causes for structured provider errors. */
const safeCause = { cause: Schema.optionalKey(Schema.Literals([
	"decode",
	"filesystem",
	"forbidden",
	"http",
	"invalid-version",
	"network",
	"output-limit",
	"rate-limit",
	"schema",
	"syntax",
	"timeout",
	"unauthorized",
	"unsupported",
	"unknown"
])) };
/** Shared provider and operation fields for provider errors. */
const providerContext = {
	operation: ProviderOperationSchema,
	providerID: ProviderIDSchema
};
//#endregion
//#region src/errors/config-decode.ts
/** Failure while parsing JSONC or decoding plugin config fields. */
var ConfigDecodeError = class extends schemaTaggedError()("ConfigDecodeError", {
	...safeCause,
	operation: Schema.Literals(["parse-jsonc", "parse-config"])
}) {};
//#endregion
//#region src/errors/config-read.ts
/** Failure while reading an existing plugin config file. */
var ConfigReadError = class extends schemaTaggedError()("ConfigReadError", {
	...safeCause,
	operation: Schema.Literal("read-config"),
	path: Schema.String
}) {
	get message() {
		return `Unable to read usage-limits config at ${this.path}`;
	}
};
//#endregion
//#region src/errors/missing-credentials.ts
/** Expected provider error raised when no usable credentials are configured. */
var MissingProviderCredentialsError = class extends schemaTaggedError()("MissingProviderCredentialsError", {
	operation: ProviderOperationSchema,
	providerID: ProviderIDSchema
}) {
	kind = "missing_credentials";
	get message() {
		return credentialMessages[this.providerID];
	}
};
//#endregion
//#region src/errors/rate-limit.ts
/** Provider rejected a request because its rate limit was reached. */
var ProviderRateLimitError = class extends schemaTaggedError()("ProviderRateLimitError", {
	...providerContext,
	retryAfterMs: Schema.optionalKey(NonNegativeFiniteSchema)
}) {
	get message() {
		return this.retryAfterMs === void 0 ? "provider rate limit reached" : `provider rate limit reached; retry after ${this.retryAfterMs}ms`;
	}
};
//#endregion
//#region src/errors/response-decode.ts
/** Provider returned a payload that could not be decoded safely. */
var ProviderResponseDecodeError = class extends schemaTaggedError()("ProviderResponseDecodeError", {
	...providerContext,
	...safeCause
}) {
	get message() {
		if (this.cause === "unsupported") return "Bailian CLI >= 1.15.0 is required for Alibaba Token Plan usage";
		if (this.cause === "invalid-version") return "could not determine the Bailian CLI version; install Bailian CLI >= 1.15.0";
		return `invalid ${{
			kimi: "Kimi Code",
			"alibaba-token-plan": "Alibaba Token Plan",
			codex: "Codex",
			commandcode: "Command Code",
			deepseek: "DeepSeek",
			minimax: "MiniMax",
			moonshotai: "Moonshot AI",
			"moonshotai-cn": "Moonshot AI CN",
			"novita-ai": "Novita AI",
			"opencode-go": "OpenCode GO",
			openrouter: "OpenRouter",
			qwen: "Qwen",
			synthetic: "Synthetic",
			zai: "ZAI"
		}[this.providerID]} usage`;
	}
};
//#endregion
//#region src/errors/timeout.ts
/** Provider operation exceeded its configured timeout. */
var ProviderTimeoutError = class extends schemaTaggedError()("ProviderTimeoutError", {
	...providerContext,
	...safeCause,
	timeoutMs: NonNegativeFiniteSchema
}) {
	get message() {
		return `provider operation timed out after ${this.timeoutMs}ms`;
	}
};
//#endregion
//#region src/errors/transport.ts
/** Provider transport failure without unsafe response content. */
var ProviderTransportError = class extends schemaTaggedError()("ProviderTransportError", {
	...providerContext,
	...safeCause,
	status: Schema.optionalKey(Schema.Int)
}) {
	get message() {
		if (this.cause === "unauthorized") return "provider credentials were rejected";
		if (this.cause === "forbidden") return "provider access was forbidden";
		return this.status === void 0 ? "provider request failed" : `provider request failed (HTTP ${this.status})`;
	}
};
//#endregion
//#region src/utils.ts
const isJsonValue = (value) => {
	if (value === null || value === void 0) return true;
	if (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || typeof value === "string") return true;
	if (Array.isArray(value)) return value.every(isJsonValue);
	if (Object.prototype.toString.call(value) !== "[object Object]") return false;
	return Object.values(value).every(isJsonValue);
};
/**
* Parses text and narrows the result to the JSON boundary type.
*
* @param input - JSON text to parse.
* @returns The parsed JSON value.
* @throws {SyntaxError} When the text is not a JSON value.
*/
const parseJsonValue = (input) => {
	const parsed = JSON.parse(input);
	if (!isJsonValue(parsed)) throw new SyntaxError("invalid JSON value");
	return parsed;
};
/**
* Checks whether a value is a plain object-like record.
*
* This intentionally excludes arrays because provider API payloads are parsed as
* `unknown` and object fields are accessed only after this guard succeeds.
*
* @param value - Value to narrow.
* @returns `true` when the value can be safely indexed as a record.
*/
const isRecord = (value) => value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
/** Narrows an unknown value to a string. */
/**
* Checks whether a value is a string and narrows its type.
*
* @param value - Value to inspect.
* @returns `true` when `value` is a string.
*/
const isString = (value) => Schema.is(Schema.String)(value);
const isTrailingComma = (input, index) => {
	let lookahead = index + 1;
	while (/\s/u.test(input[lookahead] ?? "")) lookahead += 1;
	return input[lookahead] === "}" || input[lookahead] === "]";
};
const stripTrailingCommas = (input) => {
	let output = "";
	let inString = false;
	let quote = "";
	let escaped = false;
	let index = 0;
	while (index < input.length) {
		const char = input[index];
		if (inString) {
			output += char;
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === quote) inString = false;
		} else if (char === "\"" || char === "'") {
			inString = true;
			quote = char;
			output += char;
		} else if (char === "," && isTrailingComma(input, index)) {
			index += 1;
			continue;
		} else output += char;
		index += 1;
	}
	return output;
};
const skipLineComment = (input, start) => {
	let index = start;
	while (index < input.length && input[index] !== "\n") index += 1;
	return index;
};
const skipBlockComment = (input, start) => {
	let index = start + 2;
	while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) index += 1;
	if (index >= input.length) throw new SyntaxError("Unterminated JSONC block comment");
	return index + 2;
};
/**
* Removes JSONC comments and trailing commas while preserving string contents.
*
* The plugin accepts small user-authored config files without adding a JSONC
* dependency. Both line comments and block comments are stripped, but comment
* markers inside quoted strings are left untouched.
*
* @param input - Raw JSONC text.
* @returns JSON-compatible text suitable for `JSON.parse`.
*/
const stripJsonComments = (input) => {
	let output = "";
	let inString = false;
	let quote = "";
	let escaped = false;
	let index = 0;
	while (index < input.length) {
		const char = input[index];
		const next = input[index + 1];
		if (inString) {
			output += char;
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === quote) inString = false;
		} else if (char === "\"" || char === "'") {
			inString = true;
			quote = char;
			output += char;
		} else if (char === "/" && next === "/") {
			index = skipLineComment(input, index);
			output += "\n";
		} else if (char === "/" && next === "*") index = skipBlockComment(input, index) - 1;
		else output += char;
		index += 1;
	}
	return stripTrailingCommas(output);
};
/**
* Expands a leading home-directory marker in a filesystem path.
*
* @param value - Path that may start with `~`, `~/`, or `~\`.
* @returns The path with a leading home marker replaced by the user's home path.
*/
const expandHome$1 = (value) => value === "~" || value.startsWith("~/") || value.startsWith("~\\") ? path.join(homedir(), value.slice(2)) : value;
/**
* Reads and parses a JSON or JSONC file.
*
* A leading `~` in the path is expanded before reading. The parsed value remains
* `unknown` so its owning boundary must decode it before use.
*
* @param filePath - Absolute path, relative path, or home-relative path to read.
* @returns The parsed JSON value as `unknown`.
*/
const readJsonFile = async (filePath) => {
	const raw = await readFile(expandHome$1(filePath), "utf-8");
	return parseJsonValue(stripJsonComments(raw.replace(/^\uFEFF/u, "")));
};
//#endregion
//#region src/config-schema.ts
const defaultKey = (schema, value) => schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));
const secret = Schema.RedactedFromValue(Schema.String, {
	disallowEncode: true,
	label: "credential"
});
const commonProviderFields = {
	enabled: Schema.optionalKey(Schema.Boolean),
	footerWindow: defaultKey(Schema.Literals([
		"auto",
		"rolling",
		"daily",
		"weekly",
		"monthly",
		"credits",
		"other"
	]), "auto"),
	label: Schema.optionalKey(Schema.String),
	showFooterBar: defaultKey(Schema.Boolean, true),
	showSidebarBar: defaultKey(Schema.Boolean, true),
	sidebarWindow: defaultKey(Schema.Literals([
		"all",
		"rolling",
		"daily",
		"weekly",
		"monthly",
		"credits",
		"other"
	]), "all")
};
/** Schema for Codex provider configuration. */
const codexProviderConfigSchema = Schema.Struct({
	...commonProviderFields,
	apiKey: Schema.optionalKey(secret),
	authPath: Schema.optionalKey(Schema.String),
	authorizationScheme: Schema.optionalKey(Schema.Literals(["raw", "bearer"])),
	baseUrl: Schema.optionalKey(Schema.String)
});
/** Schema for ZAI provider configuration. */
const zaiProviderConfigSchema = Schema.Struct({
	...commonProviderFields,
	apiKey: Schema.optionalKey(secret),
	authPath: Schema.optionalKey(Schema.String),
	authorizationScheme: Schema.optionalKey(Schema.Literals(["raw", "bearer"]))
});
/** Schema for OpenCode GO provider configuration. */
const openCodeGoProviderConfigSchema = Schema.Struct({
	...commonProviderFields,
	apiKey: Schema.optionalKey(secret),
	authPath: Schema.optionalKey(Schema.String),
	baseUrl: Schema.optionalKey(Schema.String)
});
const providersSchema = Schema.Struct({
	kimi: Schema.optionalKey(Schema.Struct({
		...commonProviderFields,
		apiKey: Schema.optionalKey(secret),
		authPath: Schema.optionalKey(Schema.String)
	})),
	codex: Schema.optionalKey(codexProviderConfigSchema),
	"opencode-go": Schema.optionalKey(openCodeGoProviderConfigSchema),
	zai: Schema.optionalKey(zaiProviderConfigSchema)
});
const configSchema = Schema.Struct({
	$schema: Schema.optionalKey(Schema.String),
	enabled: defaultKey(Schema.Boolean, true),
	providers: defaultKey(providersSchema, {}),
	refreshIntervalSeconds: defaultKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(15)), 300),
	requestTimeoutMs: defaultKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1e3)), 1e4),
	showErrors: defaultKey(Schema.Boolean, true)
});
const decodeConfig = Schema.decodeUnknownResult(configSchema, {
	errors: "all",
	onExcessProperty: "error"
});
const decodeCredential = Schema.decodeUnknownResult(secret);
const parseCredential = (input) => {
	const result = decodeCredential(input);
	return Result.isSuccess(result) ? result.success : void 0;
};
const parseAuthEntry = (input) => {
	if (!isRecord(input)) return;
	const apiKey = parseCredential(input.apiKey);
	const key = parseCredential(input.key);
	if (!(apiKey || key)) return;
	const entry = {};
	if (apiKey) entry.apiKey = apiKey;
	if (key) entry.key = key;
	return entry;
};
const parseOpenAIEntry = (input) => {
	if (!isRecord(input)) return;
	const access = parseCredential(input.access);
	const accountId = parseCredential(input.accountId);
	if (!(access || accountId)) return;
	const entry = {};
	if (access) entry.access = access;
	if (accountId) entry.accountId = accountId;
	return entry;
};
/**
* Validates user configuration and applies the plugin's defaults.
*
* @param input - Parsed JSON-compatible configuration value.
* @returns The resolved configuration, or a typed decoding failure.
*/
const parseUsageLimitsConfig = (input) => {
	const result = decodeConfig(input);
	if (Result.isFailure(result)) return Result.fail(new ConfigDecodeError({
		cause: "schema",
		operation: "parse-config"
	}));
	const config = { ...result.success };
	delete config.$schema;
	return Result.succeed(config);
};
/**
* Extracts supported credentials from an OpenCode auth-file value.
*
* Unsupported or malformed fields are ignored; credential values remain
* redacted until a provider adapter explicitly needs their raw form.
*
* @param input - Parsed JSON-compatible auth-file value.
* @returns Recognized credentials, or an empty object when none are usable.
*/
const parseOpenCodeAuth = (input) => {
	if (!isRecord(input)) return {};
	const openai = parseOpenAIEntry(input.openai);
	const zai = parseAuthEntry(input.zai);
	const zaiCodingPlan = parseAuthEntry(input["zai-coding-plan"]);
	const openCodeGo = parseAuthEntry(input["opencode-go"]);
	const opencode = parseAuthEntry(input.opencode);
	const auth = parseAuthEntry(input) ?? {};
	const kimi = parseAuthEntry(input["kimi-code-plan-global"]);
	if (kimi) auth["kimi-code-plan-global"] = kimi;
	if (openai) auth.openai = openai;
	if (zai) auth.zai = zai;
	if (zaiCodingPlan) auth["zai-coding-plan"] = zaiCodingPlan;
	if (openCodeGo) auth["opencode-go"] = openCodeGo;
	if (opencode) auth.opencode = opencode;
	return auth;
};
//#endregion
//#region src/config.ts
/**
* Resolves an XDG directory only when the environment value is absolute.
*
* @param value - The XDG environment value to inspect.
* @param fallback - The platform-specific directory to use otherwise.
* @returns The accepted XDG directory or the fallback directory.
*/
const resolveXdgPath = (value, fallback) => value && path.isAbsolute(value) ? value : fallback;
/** Default user configuration path for this plugin. */
const CONFIG_PATH = path.join(resolveXdgPath(process.env.XDG_CONFIG_HOME, path.join(homedir(), ".config")), "opencode", "usage-limits.jsonc");
/**
* Resolves OpenCode's default auth-file path for the given runtime platform.
*
* @param platform - Runtime platform identifier, such as `win32` or `linux`.
* @param dataHome - Absolute XDG data directory override, if configured.
* @param localAppData - Windows local application-data directory, if available.
* @param home - User home directory used as the final fallback.
* @returns Absolute path to OpenCode's `auth.json` file.
*/
const defaultOpenCodeAuthPath = (platform, dataHome, localAppData, home) => path.join(resolveXdgPath(dataHome, platform === "win32" ? localAppData ?? path.join(home, "AppData", "Local") : path.join(home, ".local", "share")), "opencode", "auth.json");
const OPENCODE_AUTH_PATH = defaultOpenCodeAuthPath(process.platform, process.env.XDG_DATA_HOME, process.env.LOCALAPPDATA, homedir());
/** Fully resolved defaults used when no plugin config exists. */
const DEFAULT_CONFIG = {
	enabled: true,
	providers: {},
	refreshIntervalSeconds: 300,
	requestTimeoutMs: 1e4,
	showErrors: true
};
const isMissingFile = (error) => error instanceof Error && "code" in error && error.code === "ENOENT";
const AUTH_DECODE_KIND = "auth-decode";
const authEntryNames = /* @__PURE__ */ new Set([
	"kimi-code-plan-global",
	"openai",
	"opencode",
	"opencode-go",
	"zai",
	"zai-coding-plan"
]);
const authFields = /* @__PURE__ */ new Set([
	"access",
	"accountId",
	"apiKey",
	"key"
]);
const directAuthFieldNames = /* @__PURE__ */ new Set(["apiKey", "key"]);
const hasMalformedAuthField = (input) => {
	if (!isRecord(input)) return true;
	return Object.entries(input).some(([key, value]) => authFields.has(key) && !isString(value));
};
/**
* Reads and validates the user's usage-limits configuration file.
*
* Missing files resolve to {@link DEFAULT_CONFIG}; read and decode failures are
* returned as typed failures rather than thrown.
*
* @param read - Injectable file reader, defaulting to the filesystem reader.
* @returns Resolved configuration or a typed read/decode failure.
*/
const loadConfig = async (read = readJsonFile) => {
	try {
		return parseUsageLimitsConfig(await read(CONFIG_PATH));
	} catch (error) {
		if (error instanceof Error && isMissingFile(error)) return Result.succeed(DEFAULT_CONFIG);
		if (error instanceof SyntaxError) return Result.fail(new ConfigDecodeError({
			cause: "syntax",
			operation: "parse-jsonc"
		}));
		return Result.fail(new ConfigReadError({
			cause: "filesystem",
			operation: "read-config",
			path: CONFIG_PATH
		}));
	}
};
/**
* Reads supported credentials from OpenCode's shared auth file.
*
* Auth-file absence and read/decode problems are reported as non-fatal
* diagnostics so provider-specific credential sources can still be tried.
*
* @param read - Injectable file reader, defaulting to the filesystem reader.
* @returns Recognized auth values and an optional diagnostic.
*/
const loadOpenCodeAuth = async (read = readJsonFile) => {
	try {
		const input = await read(OPENCODE_AUTH_PATH);
		if (!isRecord(input)) return {
			auth: {},
			diagnostic: {
				kind: AUTH_DECODE_KIND,
				message: "OpenCode auth has an unsupported format"
			}
		};
		const auth = parseOpenCodeAuth(input);
		return Object.entries(input).some(([key, value]) => authEntryNames.has(key) ? hasMalformedAuthField(value) : directAuthFieldNames.has(key) && !isString(value)) ? {
			auth,
			diagnostic: {
				kind: "auth-decode",
				message: "Some OpenCode auth fields could not be read"
			}
		} : { auth };
	} catch (error) {
		if (error instanceof Error && isMissingFile(error)) return {
			auth: {},
			diagnostic: {
				kind: "auth-missing",
				message: "OpenCode auth file was not found"
			}
		};
		if (error instanceof SyntaxError) return {
			auth: {},
			diagnostic: {
				kind: AUTH_DECODE_KIND,
				message: "OpenCode auth could not be parsed"
			}
		};
		return {
			auth: {},
			diagnostic: {
				kind: "auth-read",
				message: "OpenCode auth could not be read"
			}
		};
	}
};
//#endregion
//#region src/providers/json.ts
const JsonNumber = Schema.Number;
const JsonString = Schema.String;
Schema.Boolean;
/** Narrows a JSON value to a number. */
const isJsonNumber = (value) => Schema.is(JsonNumber)(value);
/** Narrows a JSON value to a string. */
const isJsonString = (value) => Schema.is(JsonString)(value);
//#endregion
//#region src/providers/runtime/environment.ts
const environmentReference = /^\{env:(?<name>[^}]+)\}$/iu;
const nonEmptySecret = (value) => {
	const revealed = Redacted.isRedacted(value) ? Redacted.value(value) : value;
	if (!Schema.is(Schema.String)(revealed)) return;
	const trimmed = revealed.trim();
	return trimmed === "" ? void 0 : Redacted.make(trimmed);
};
/** Credential parsing and environment lookup without exposing secret values. */
var ProviderEnvironment = class extends Context.Service()("oc-usage-limits/ProviderEnvironment") {};
/** Constructs an environment service over a specific environment map. */
const makeProviderEnvironment = (environment) => ({
	credential: nonEmptySecret,
	resolveCredential: (value) => {
		const credential = nonEmptySecret(value);
		if (!credential) return credential;
		const raw = Redacted.value(credential);
		const match = environmentReference.exec(raw);
		return match?.groups?.name ? nonEmptySecret(environment[match.groups.name]) : credential;
	}
});
/** Live layer resolving literal and `{env:NAME}` credentials from process env. */
const ProviderEnvironmentLive = Layer.succeed(ProviderEnvironment, makeProviderEnvironment(process.env));
//#endregion
//#region src/providers/runtime/filesystem.ts
const MAX_AUTH_FILE_BYTES = 1048576;
const expandHome = (value) => value === "~" || value.startsWith("~/") || value.startsWith("~\\") ? path.join(homedir(), value.slice(2)) : value;
const readFileContents = async (file, buffer, offset = 0) => {
	const result = await file.read(buffer, offset, buffer.byteLength - offset, offset);
	return result.bytesRead === 0 ? offset : readFileContents(file, buffer, offset + result.bytesRead);
};
/** Bounded provider credential-file access and JSON decoding. */
var ProviderFileSystem = class extends Context.Service()("oc-usage-limits/ProviderFileSystem") {};
const readText = (input) => Effect.tryPromise({
	catch: () => new ProviderTransportError({
		cause: "filesystem",
		operation: "read-auth",
		providerID: input.providerID
	}),
	try: async () => {
		const file = await open(expandHome(input.path), "r");
		try {
			if ((await file.stat()).size > MAX_AUTH_FILE_BYTES) return null;
			const buffer = Buffer.alloc(1048577);
			const bytesRead = await readFileContents(file, buffer);
			return bytesRead > MAX_AUTH_FILE_BYTES ? null : buffer.subarray(0, bytesRead).toString("utf-8");
		} finally {
			await file.close();
		}
	}
}).pipe(Effect.flatMap((text) => text === null ? Effect.fail(new ProviderTransportError({
	cause: "output-limit",
	operation: "read-auth",
	providerID: input.providerID
})) : Effect.succeed(text)));
/** Live layer providing bounded provider credential-file reads. */
const ProviderFileSystemLive = Layer.succeed(ProviderFileSystem, {
	readJson: (input) => readText(input).pipe(Effect.flatMap((text) => Effect.try({
		catch: () => new ProviderResponseDecodeError({
			cause: "syntax",
			operation: "read-auth",
			providerID: input.providerID
		}),
		try: () => parseJsonValue(text)
	}))),
	readText
});
//#endregion
//#region src/providers/runtime/http.ts
const MAX_RESPONSE_BYTES = 2097152;
const FETCH_OPERATION = "fetch-usage";
const cancelReader = async (reader) => {
	try {
		await reader.cancel();
	} catch {}
};
const cancelBody = async (response) => {
	try {
		await response.body?.cancel();
	} catch {}
};
const chunksFromReader = (reader) => ({ [Symbol.asyncIterator]: () => ({ next: async () => {
	const result = await reader.read();
	if (result.done) return {
		done: true,
		value: null
	};
	return {
		done: false,
		value: result.value
	};
} }) });
const readChunks = async (reader, chunks, length) => {
	let totalLength = length;
	let exceeded = false;
	for await (const chunk of chunksFromReader(reader)) {
		const nextLength = totalLength + chunk.byteLength;
		if (nextLength > MAX_RESPONSE_BYTES) {
			exceeded = true;
			break;
		}
		chunks.push(chunk);
		totalLength = nextLength;
	}
	if (exceeded) {
		await cancelReader(reader);
		throw new RangeError("response limit exceeded");
	}
	return totalLength;
};
/** Bounded, interruptible JSON HTTP transport with provider-safe failures. */
var ProviderHttpClient = class extends Context.Service()("oc-usage-limits/ProviderHttpClient") {};
const retryAfterMilliseconds = (response) => {
	const seconds = Number(response.headers.get("retry-after"));
	return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1e3 : void 0;
};
const readBoundedBody = async (response, signal) => {
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
		await cancelBody(response);
		throw new RangeError("response limit exceeded");
	}
	if (!response.body) return /* @__PURE__ */ new Uint8Array();
	const reader = response.body.getReader();
	const chunks = [];
	let length = 0;
	const abort = () => {
		cancelReader(reader);
	};
	signal.addEventListener("abort", abort, { once: true });
	try {
		length = await readChunks(reader, chunks, length);
	} finally {
		signal.removeEventListener("abort", abort);
	}
	const body = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
};
/**
* Constructs the provider HTTP service over an injectable Fetch implementation.
*
* Responses are size-limited, requests are interruptible and timed, and failures
* are converted to provider-safe typed errors.
*
* @param fetchImplementation - Fetch-compatible request function.
* @returns Effect layer providing the configured HTTP client.
*/
const makeProviderHttpClient = (fetchImplementation) => Layer.succeed(ProviderHttpClient, { requestJson: (request) => {
	return Effect.tryPromise({
		catch: (error) => {
			if (error instanceof ProviderRateLimitError || error instanceof ProviderTransportError || error instanceof ProviderResponseDecodeError) return error;
			return error instanceof RangeError ? new ProviderResponseDecodeError({
				cause: "output-limit",
				operation: "decode-response",
				providerID: request.providerID
			}) : new ProviderTransportError({
				cause: "network",
				operation: FETCH_OPERATION,
				providerID: request.providerID
			});
		},
		try: async (signal) => {
			const response = await fetchImplementation(request.url, {
				headers: request.headers,
				method: request.method,
				signal,
				...request.redirect ? { redirect: request.redirect } : {}
			});
			if (response.status === 429) {
				await cancelBody(response);
				const retryAfterMs = retryAfterMilliseconds(response);
				if (retryAfterMs === void 0) throw new ProviderRateLimitError({
					operation: FETCH_OPERATION,
					providerID: request.providerID
				});
				throw new ProviderRateLimitError({
					operation: FETCH_OPERATION,
					providerID: request.providerID,
					retryAfterMs
				});
			}
			if (!response.ok) {
				let cause = "http";
				if (response.status === 401) cause = "unauthorized";
				else if (response.status === 403) cause = "forbidden";
				await cancelBody(response);
				throw new ProviderTransportError({
					cause,
					operation: "fetch-usage",
					providerID: request.providerID,
					status: response.status
				});
			}
			const body = await readBoundedBody(response, signal);
			try {
				return parseJsonValue(new TextDecoder().decode(body));
			} catch {
				throw new ProviderResponseDecodeError({
					cause: "decode",
					operation: "decode-response",
					providerID: request.providerID
				});
			}
		}
	}).pipe(Effect.timeoutOrElse({
		duration: request.timeoutMs,
		orElse: () => Effect.fail(new ProviderTimeoutError({
			cause: "timeout",
			operation: FETCH_OPERATION,
			providerID: request.providerID,
			timeoutMs: request.timeoutMs
		}))
	}));
} });
/** Live layer providing bounded JSON requests through `globalThis.fetch`. */
const ProviderHttpClientLive = makeProviderHttpClient((input, init) => globalThis.fetch(input, init));
//#endregion
//#region src/providers/runtime/index.ts
/**
* Production provider runtime layer composed from the live platform services.
*
* Provides environment, filesystem, and HTTP capabilities required by provider
* adapters.
*/
const ProviderRuntimeLive = Layer.mergeAll(ProviderEnvironmentLive, ProviderFileSystemLive, ProviderHttpClientLive);
//#endregion
//#region src/utils/url.ts
/**
* Determines whether a hostname refers to the local machine.
*
* Loopback hosts are the only case where plain `http` is permitted, so local
* test servers do not require a TLS certificate.
*
* @param hostname - Hostname from a parsed URL (no port; IPv6 literals keep
*   their surrounding brackets per the WHATWG URL standard).
* @returns `true` when the host is a loopback address.
*/
const isLoopbackHost = (hostname) => {
	const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
	return host === "localhost" || host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host);
};
/**
* Resolves and validates an HTTPS API base URL before it reaches a request.
*
* Only `https` URLs are allowed; `http` is permitted solely for loopback hosts.
* Anything that fails to parse, or uses another scheme, falls back to the
* default so credentials are never sent to an unexpected host.
*
* @param baseUrl - Configured base URL, or `undefined` for the default.
* @param defaultUrl - Safe fallback when the configured value is invalid.
* @returns A safe, absolute URL string with no trailing slash.
*/
const resolveHttpsBaseUrl = (baseUrl, defaultUrl) => {
	const fallback = defaultUrl.replace(/\/$/u, "");
	let parsed;
	try {
		parsed = new URL((baseUrl ?? defaultUrl).trim());
	} catch {
		return fallback;
	}
	if (parsed.username !== "" || parsed.password !== "") return fallback;
	return parsed.protocol === "https:" || isLoopbackHost(parsed.hostname) && parsed.protocol === "http:" ? parsed.toString().replace(/\/$/u, "") : fallback;
};
//#endregion
//#region src/providers/codex.ts
/** Default ChatGPT backend base URL used for Codex usage requests. */
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const parseCodexAuth = (value) => {
	if (!isRecord(value.tokens)) return null;
	return { tokens: {
		access_token: value.tokens.access_token,
		account_id: value.tokens.account_id
	} };
};
const parseCodexWindow = (window) => {
	if (window.used_percent !== void 0 && !isJsonNumber(window.used_percent)) return null;
	return {
		limit_window_seconds: isJsonNumber(window.limit_window_seconds) ? window.limit_window_seconds : void 0,
		reset_at: isJsonNumber(window.reset_at) ? window.reset_at : void 0,
		used_percent: isJsonNumber(window.used_percent) ? window.used_percent : void 0
	};
};
const parseCodexPayload = (value) => {
	const rateLimit = isRecord(value.rate_limit) ? value.rate_limit : void 0;
	return {
		plan_type: isJsonString(value.plan_type) ? value.plan_type : void 0,
		rate_limit: rateLimit ? {
			primary_window: isRecord(rateLimit.primary_window) ? parseCodexWindow(rateLimit.primary_window) ?? void 0 : void 0,
			secondary_window: isRecord(rateLimit.secondary_window) ? parseCodexWindow(rateLimit.secondary_window) ?? void 0 : void 0
		} : void 0,
		rate_limit_reset_credits: isRecord(value.rate_limit_reset_credits) && isJsonNumber(value.rate_limit_reset_credits.available_count) ? { available_count: value.rate_limit_reset_credits.available_count } : void 0
	};
};
const resetCreditsFromPayload = (payload) => {
	const availableCount = payload.rate_limit_reset_credits?.available_count;
	return availableCount !== void 0 && Number.isFinite(availableCount) && availableCount >= 0 ? availableCount : null;
};
/**
* Reads Codex credentials from the Codex CLI auth file.
*
* @param authPath - Optional path override. Defaults to `~/.codex/auth.json`.
* @returns Access token and ChatGPT account ID required by the Codex usage API.
* @throws {Error} When the auth file is missing or does not contain credentials.
* @throws {TypeError} When the auth file contains credentials with invalid types.
*/
const readCodexAuthFile = (authPath) => Effect.gen(function* loadCodexAuthFile() {
	const files = yield* ProviderFileSystem;
	const environment = yield* ProviderEnvironment;
	const auth = yield* files.readJson({
		path: authPath ?? "~/.codex/auth.json",
		providerID: "codex"
	});
	const parsedAuth = isRecord(auth) ? parseCodexAuth(auth) : null;
	if (!parsedAuth) return yield* new MissingProviderCredentialsError({
		operation: "read-auth",
		providerID: "codex"
	});
	const access = environment.credential(parsedAuth.tokens.access_token);
	const accountId = environment.credential(parsedAuth.tokens.account_id);
	if (!access || !accountId) return yield* new MissingProviderCredentialsError({
		operation: "read-auth",
		providerID: "codex"
	});
	return {
		access,
		accountId
	};
});
/**
* Loads fallback credentials in configured precedence order.
*
* An explicit auth file wins over an API key, and an API key wins over the
* default Codex auth file. This preserves the credential order used before
* retrying rejected OpenCode credentials.
*/
const loadCodexFallbackCredentials = (config, isOfficialHost, openCodeAccountId, configuredAccess) => Effect.gen(function* loadFallbackCredentials() {
	if (config?.authPath) return yield* readCodexAuthFile(config.authPath);
	if (configuredAccess) return {
		access: configuredAccess,
		accountId: isOfficialHost ? openCodeAccountId ?? Redacted.make("configured") : Redacted.make("configured")
	};
	return yield* readCodexAuthFile(globalThis.undefined);
});
const loadCodexCredentials = (config, isOfficialHost, openCodeAccess, openCodeAccountId, configuredAccess) => Effect.gen(function* loadCredentials() {
	if (!isOfficialHost && !config?.authPath && !configuredAccess) return yield* new MissingProviderCredentialsError({
		operation: "fetch-usage",
		providerID: "codex"
	});
	if (isOfficialHost && openCodeAccess && openCodeAccountId) return {
		access: openCodeAccess,
		accountId: openCodeAccountId
	};
	return yield* loadCodexFallbackCredentials(config, isOfficialHost, openCodeAccountId, configuredAccess);
});
/**
* Converts a raw Codex rate-limit window into the plugin's normalized shape.
*
* @param value - Unknown `primary_window` or `secondary_window` payload.
* @param fallback - Label used when the provider does not report a known window
*   length.
* @returns A normalized usage window, or `null` for invalid payloads.
*/
const codexWindow = (value, fallback) => {
	if (!value) return null;
	const parsedUsed = parseUsagePercentage(value.used_percent);
	if (value.used_percent !== void 0 && Result.isFailure(parsedUsed)) return null;
	const used = Result.isSuccess(parsedUsed) ? parsedUsed.success : null;
	const windowSeconds = value.limit_window_seconds ?? 0;
	const resetAt = resetInstantOrNull(value.reset_at !== void 0 && value.reset_at > 0 ? /* @__PURE__ */ new Date(value.reset_at * 1e3) : null);
	return {
		kind: windowSeconds > 0 ? "rolling" : "other",
		label: windowSeconds > 0 ? limitLabelForWindow(windowSeconds, fallback) : fallback,
		quota: used === null ? unknownQuota : percentageQuota(used),
		resetsAt: resetAt
	};
};
const reportedWindowsAreInvalid = (rateLimit, windows) => rateLimit !== void 0 && (rateLimit.primary_window !== void 0 || rateLimit.secondary_window !== void 0) && windows.length === 0;
const requestCodexUsage = (requestUsage, credentials, fallbackCredentials, canFallbackToCodexAuth) => Effect.gen(function* requestWithFallback() {
	const firstAttempt = yield* Effect.match(requestUsage(credentials), {
		onFailure: (error) => ({ error }),
		onSuccess: (data) => ({ data })
	});
	if ("data" in firstAttempt) return firstAttempt.data;
	const unauthorizedResponse = firstAttempt.error instanceof ProviderTransportError && firstAttempt.error.cause === "unauthorized";
	if (!canFallbackToCodexAuth || !unauthorizedResponse) return yield* firstAttempt.error;
	const fallback = yield* Effect.match(fallbackCredentials, {
		onFailure: () => ({ credentials: null }),
		onSuccess: (nextCredentials) => ({ credentials: nextCredentials })
	});
	if (fallback.credentials === null) return yield* firstAttempt.error;
	return yield* requestUsage(fallback.credentials);
});
/**
* Fetches and normalizes Codex usage limits.
*
* Credentials are read from OpenCode auth when available, otherwise from the
* Codex CLI auth file. The returned windows represent the primary and secondary
* Codex rate-limit windows reported by ChatGPT's backend API.
*
* @param config - Optional Codex provider configuration.
* @param openCodeAuth - Shared OpenCode auth payload.
* @param timeoutMs - Request timeout in milliseconds.
* @returns Normalized Codex usage data.
* @throws {Error} When credentials are missing or the provider response is invalid.
*/
const fetchCodexUsageEffect = (config, openCodeAuth, timeoutMs) => Effect.gen(function* runFetchCodexUsage() {
	const environment = yield* ProviderEnvironment;
	const http = yield* ProviderHttpClient;
	const baseUrl = resolveHttpsBaseUrl(config?.baseUrl, DEFAULT_CODEX_BASE_URL);
	const isOfficialHost = new URL(baseUrl).hostname === "chatgpt.com";
	const openCodeAccess = environment.credential(openCodeAuth.openai?.access);
	const openCodeAccountId = environment.credential(openCodeAuth.openai?.accountId);
	const configuredAccess = environment.resolveCredential(config?.apiKey);
	const credentials = yield* loadCodexCredentials(config, isOfficialHost, openCodeAccess, openCodeAccountId, configuredAccess);
	const canFallbackToCodexAuth = isOfficialHost && openCodeAccess !== void 0 && openCodeAccountId !== void 0;
	const requestUsage = (currentCredentials) => http.requestJson({
		headers: {
			Authorization: `Bearer ${Redacted.value(currentCredentials.access)}`,
			"ChatGPT-Account-Id": Redacted.value(currentCredentials.accountId),
			"User-Agent": "opencode-usage-limits"
		},
		method: "GET",
		providerID: "codex",
		timeoutMs,
		url: `${baseUrl}/wham/usage`
	});
	const payload = yield* requestCodexUsage(requestUsage, credentials, loadCodexFallbackCredentials(config, isOfficialHost, openCodeAccountId, configuredAccess), canFallbackToCodexAuth);
	const parsedPayload = isRecord(payload) ? parseCodexPayload(payload) : null;
	if (!parsedPayload) return yield* new ProviderResponseDecodeError({
		cause: "schema",
		operation: "decode-response",
		providerID: "codex"
	});
	const rateLimit = parsedPayload.rate_limit;
	const primaryWindow = codexWindow(rateLimit?.primary_window, "usage");
	const windows = [primaryWindow, codexWindow(rateLimit?.secondary_window, "secondary")].filter((item) => item !== null);
	if (!primaryWindow || reportedWindowsAreInvalid(rateLimit, windows)) return yield* new ProviderResponseDecodeError({
		cause: "schema",
		operation: "decode-response",
		providerID: "codex"
	});
	const resetCredits = resetCreditsFromPayload(parsedPayload);
	return {
		capturedAt: new Date(yield* Clock.currentTimeMillis),
		id: "codex",
		label: config?.label ?? "Codex",
		metadata: { resetCredits },
		tierName: parsedPayload.plan_type,
		windows
	};
});
/** Plugin registration for the Codex provider adapter. */
/** Codex provider adapter and OpenCode provider-ID mapping. */
const codexProvider = {
	defaultLabel: "Codex",
	displayOrder: 0,
	fetch: fetchCodexUsageEffect,
	footerWindowKind: "rolling",
	id: "codex",
	openCodeProviderIDs: ["openai"]
};
//#endregion
//#region src/providers/auth-file.ts
/**
* Loads a credential from an optional provider auth file.
*
* Missing, unreadable, malformed, and non-object files yield `undefined` so the
* caller can continue its provider-specific credential lookup order.
*
* @param authPath - Optional path to the provider auth file.
* @param providerID - Provider ID used to classify filesystem failures.
* @param extractor - Provider-specific credential extractor for object JSON.
* @returns The extracted credential, or `undefined` when loading cannot supply one.
*/
const readProviderAuthFileCredential = (authPath, providerID, extractor) => {
	if (!authPath) return Effect.undefined;
	return Effect.gen(function* loadProviderAuthFileCredential() {
		const files = yield* ProviderFileSystem;
		const environment = yield* ProviderEnvironment;
		const auth = yield* files.readJson({
			path: authPath,
			providerID
		});
		return isRecord(auth) ? extractor(auth, environment.credential) : void 0;
	}).pipe(Effect.catchCause(() => Effect.undefined));
};
//#endregion
//#region src/providers/kimi.ts
const USAGE_URL = "https://api.kimi.ai/coding/v1/usages";
const numeric = (value) => {
	if (typeof value !== "number" && !(typeof value === "string" && /^\d+(?:\.\d+)?$/u.test(value))) return;
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : void 0;
};
const windowFrom = (value, kind, label, ratio) => {
	if (!isRecord(value)) return null;
	let usedPercent;
	if (ratio) {
		const usedRatio = numeric(value.used_ratio);
		if (usedRatio !== void 0) usedPercent = usedRatio * 100;
	} else {
		const total = numeric(value.limit);
		const used = numeric(value.used);
		const remaining = numeric(value.remaining);
		if (total !== void 0 && total > 0) {
			if (used !== void 0) usedPercent = used / total * 100;
			else if (remaining !== void 0 && remaining <= total) usedPercent = (total - remaining) / total * 100;
		}
	}
	if (usedPercent === void 0 || !Number.isFinite(usedPercent)) return null;
	const percentage = parseUsagePercentage(Math.min(usedPercent, 100));
	if (Result.isFailure(percentage)) return null;
	const reset = value.reset_time ?? value.resetTime;
	return {
		kind,
		label,
		quota: percentageQuota(percentage.success),
		resetsAt: resetInstantOrNull(typeof reset === "string" ? new Date(reset) : null)
	};
};
const parseWindows = (payload) => {
	if (!isRecord(payload)) return [];
	const windows = [];
	const add = (window) => {
		if (window && !windows.some((w) => w.kind === window.kind && w.label === window.label)) windows.push(window);
	};
	if (isRecord(payload.usages)) {
		add(windowFrom(payload.usages.limit_5h, "rolling", "5h", true));
		add(windowFrom(payload.usages.limit_month_total, "monthly", "monthly", true));
		add(windowFrom(payload.usages.limit_month_code, "monthly", "monthly code", true));
	}
	add(windowFrom(payload.usage, "weekly", "weekly", false));
	if (Array.isArray(payload.limits)) for (const limit of payload.limits.slice(0, 16)) {
		if (!isRecord(limit) || !isRecord(limit.window)) continue;
		const duration = numeric(limit.window.duration);
		const unit = limit.window.timeUnit;
		if (duration === 300 && unit === "TIME_UNIT_MINUTE" || duration === 5 && unit === "TIME_UNIT_HOUR") add(windowFrom(limit.detail ?? limit, "rolling", "5h", false));
	}
	return windows;
};
const keyFromAuth$1 = (value, credential) => {
	const entry = value["kimi-code-plan-global"];
	return isRecord(entry) ? credential(entry.key) ?? credential(entry.apiKey) : credential(value.key) ?? credential(value.apiKey);
};
const fetchKimiUsageEffect = (config, auth, timeoutMs) => Effect.gen(function* () {
	const environment = yield* ProviderEnvironment;
	const http = yield* ProviderHttpClient;
	const key = (yield* readProviderAuthFileCredential(config?.authPath, "kimi", keyFromAuth$1)) ?? (isRecord(auth) ? keyFromAuth$1(auth, environment.credential) : void 0) ?? environment.resolveCredential(config?.apiKey);
	if (!key) return yield* new MissingProviderCredentialsError({
		operation: "fetch-usage",
		providerID: "kimi"
	});
	const payload = yield* http.requestJson({
		url: USAGE_URL,
		method: "GET",
		redirect: "error",
		headers: {
			Authorization: `Bearer ${Redacted.value(key)}`,
			Accept: "application/json"
		},
		providerID: "kimi",
		timeoutMs
	});
	const windows = parseWindows(payload);
	if (windows.length === 0) return yield* new ProviderResponseDecodeError({
		cause: "schema",
		operation: "decode-response",
		providerID: "kimi"
	});
	return {
		id: "kimi",
		label: config?.label ?? "Kimi Code",
		capturedAt: new Date(yield* Clock.currentTimeMillis),
		windows
	};
});
const kimiProvider = {
	id: "kimi",
	defaultLabel: "Kimi Code",
	displayOrder: 6,
	footerWindowKind: "rolling",
	openCodeProviderIDs: ["kimi-code-plan-global"],
	fetch: fetchKimiUsageEffect
};
//#endregion
//#region src/providers/opencode-go.ts
/** Default OpenCode GO API base URL. */
const DEFAULT_OPEN_CODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
const PROVIDER_ID = "opencode-go";
const parseOpenCodeGoWindow = (window) => ({
	percent: isJsonNumber(window.percent) ? window.percent : void 0,
	resetsAt: isJsonString(window.resetsAt) ? window.resetsAt : void 0
});
const parseOpenCodeGoPayload = (value) => {
	if (!isRecord(value.usage)) return null;
	return { usage: {
		monthly: isRecord(value.usage.monthly) ? parseOpenCodeGoWindow(value.usage.monthly) : void 0,
		rolling: isRecord(value.usage.rolling) ? parseOpenCodeGoWindow(value.usage.rolling) : void 0,
		weekly: isRecord(value.usage.weekly) ? parseOpenCodeGoWindow(value.usage.weekly) : void 0
	} };
};
const keyFromAuth = (value, credential) => {
	for (const entry of [value["opencode-go"], value.opencode]) {
		if (!isRecord(entry)) continue;
		const key = credential(entry.key) ?? credential(entry.apiKey);
		if (key) return key;
	}
	return credential(value.key) ?? credential(value.apiKey);
};
const usageWindow = (value, kind, label) => {
	if (!value) return null;
	const percent = parseUsagePercentage(value.percent);
	if (Result.isFailure(percent)) return null;
	return {
		kind,
		label,
		quota: percentageQuota(percent.success),
		resetsAt: resetInstantOrNull(value.resetsAt === void 0 ? null : new Date(value.resetsAt))
	};
};
/** Fetches and normalizes OpenCode GO usage windows. */
const fetchOpenCodeGoUsageEffect = (config, openCodeAuth, timeoutMs) => Effect.gen(function* runFetchOpenCodeGoUsage() {
	const environment = yield* ProviderEnvironment;
	const http = yield* ProviderHttpClient;
	const baseUrl = resolveHttpsBaseUrl(config?.baseUrl, DEFAULT_OPEN_CODE_GO_BASE_URL);
	const officialHost = new URL(baseUrl).hostname === "opencode.ai";
	const authPathKey = yield* readProviderAuthFileCredential(config?.authPath, PROVIDER_ID, keyFromAuth);
	const configuredKey = environment.resolveCredential(config?.apiKey);
	const authKey = isRecord(openCodeAuth) ? keyFromAuth(openCodeAuth, environment.credential) : void 0;
	const apiKey = authPathKey ?? (officialHost ? authKey ?? configuredKey : configuredKey);
	if (!apiKey) return yield* new MissingProviderCredentialsError({
		operation: "fetch-usage",
		providerID: PROVIDER_ID
	});
	const payload = yield* http.requestJson({
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${Redacted.value(apiKey)}`
		},
		method: "GET",
		providerID: PROVIDER_ID,
		timeoutMs,
		url: `${baseUrl}/usage`
	});
	const parsedPayload = isRecord(payload) ? parseOpenCodeGoPayload(payload) : null;
	if (!parsedPayload) return yield* new ProviderResponseDecodeError({
		cause: "schema",
		operation: "decode-response",
		providerID: PROVIDER_ID
	});
	const windows = [
		usageWindow(parsedPayload.usage.rolling, "rolling", "rolling"),
		usageWindow(parsedPayload.usage.weekly, "weekly", "weekly"),
		usageWindow(parsedPayload.usage.monthly, "monthly", "monthly")
	].filter((window) => window !== null);
	if (windows.length === 0) return yield* new ProviderResponseDecodeError({
		cause: "schema",
		operation: "decode-response",
		providerID: PROVIDER_ID
	});
	return {
		capturedAt: new Date(yield* Clock.currentTimeMillis),
		id: PROVIDER_ID,
		label: config?.label ?? "OpenCode GO",
		windows
	};
});
/** Plugin registration for the OpenCode GO provider adapter. */
/** OpenCode GO provider adapter and session provider-ID mapping. */
const openCodeGoProvider = {
	defaultLabel: "OpenCode GO",
	displayOrder: 5,
	fetch: fetchOpenCodeGoUsageEffect,
	footerWindowKind: "rolling",
	id: "opencode-go",
	openCodeProviderIDs: [PROVIDER_ID]
};
//#endregion
//#region src/providers/zai-coding-plan.ts
/** ZAI Coding Plan quota endpoint used to fetch usage limits. */
const ZAI_QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const DECODE_RESPONSE_OPERATION = "decode-response";
const parseZaiPayload = (value) => {
	if (!isRecord(value.data) || !Array.isArray(value.data.limits)) return null;
	return { data: { limits: value.data.limits.flatMap((limit) => {
		if (!isRecord(limit)) return [];
		return [{
			unit: isJsonNumber(limit.unit) ? limit.unit : void 0,
			number: isJsonNumber(limit.number) ? limit.number : void 0,
			currentValue: isJsonNumber(limit.currentValue) ? limit.currentValue : void 0,
			nextResetTime: isJsonNumber(limit.nextResetTime) ? limit.nextResetTime : void 0,
			percentage: isJsonNumber(limit.percentage) ? limit.percentage : void 0,
			type: isJsonString(limit.type) ? limit.type : void 0,
			usage: isJsonNumber(limit.usage) ? limit.usage : void 0
		}];
	}) } };
};
/**
* Infers the ZAI plan tier from the provider's prompt/time quota total.
*
* @param total - Total quota reported by the ZAI time-limit payload.
* @returns The inferred tier name, or `undefined` when it cannot be inferred.
*/
const inferZaiTier = (total) => {
	if (total === null) return;
	if (total >= 1400) return "Max";
	if (total >= 300) return "Pro";
	if (total > 0) return "Lite";
};
const zaiQuota = (current, total, usedPercent) => {
	const parsedUsed = parseUsagePercentage(usedPercent);
	if (Result.isFailure(parsedUsed)) return unknownQuota;
	const parsedCurrent = parseUsageCount(current);
	const parsedTotal = parseUsageCount(total);
	if (Result.isSuccess(parsedCurrent) && Result.isSuccess(parsedTotal) && parsedCurrent.success <= parsedTotal.success) return countQuota(parsedCurrent.success, parsedTotal.success, parsedUsed.success);
	return percentageQuota(parsedUsed.success);
};
/**
* Extracts a ZAI API key from any supported auth object shape.
*
* The plugin accepts both direct `{ key }`/`{ apiKey }` objects and the nested
* shapes used by OpenCode auth.
*
* @param value - Unknown auth payload to inspect.
* @returns The first recognized API key.
*/
const keyFromZaiAuth = (value, credential) => {
	const directKey = credential(value.key);
	if (directKey) return directKey;
	const directApiKey = credential(value.apiKey);
	if (directApiKey) return directApiKey;
	const zaiCodingPlan = value["zai-coding-plan"];
	if (isRecord(zaiCodingPlan)) {
		const key = credential(zaiCodingPlan.key);
		if (key) return key;
	}
	if (isRecord(value.zai)) return credential(value.zai.key);
};
/**
* Converts one raw ZAI limit entry into a normalized usage window.
*
* Token limits become the primary `5h` quota window. Time limits are not shown
* but still expose the total prompt quota used to infer the user's ZAI tier.
*
* @param limit - Raw limit object from the ZAI quota API.
* @returns The normalized window plus any prompt total discovered on the entry.
*/
const zaiWindowFromLimit = (limit) => {
	const parsedUsed = parseUsagePercentage(limit.percentage);
	const usedPercent = Result.isSuccess(parsedUsed) ? parsedUsed.success : null;
	const resetsAt = resetInstantOrNull(limit.nextResetTime === void 0 ? null : new Date(limit.nextResetTime));
	const usageTotal = limit.usage;
	if (limit.type === "CREDIT_LIMIT") {
		const rolling = limit.unit === 3 && limit.number === 5;
		const weekly = limit.unit === 6 && limit.number === 1;
		if (!rolling && !weekly) return {
			promptTotal: null,
			window: null
		};
		return {
			promptTotal: null,
			window: {
				kind: rolling ? "rolling" : "weekly",
				label: rolling ? "5h" : "weekly",
				quota: zaiQuota(limit.currentValue, usageTotal, usedPercent),
				resetsAt
			}
		};
	}
	if (limit.type === "TOKENS_LIMIT") {
		const rawCurrentValue = limit.currentValue;
		const currentValue = rawCurrentValue === void 0 ? void 0 : Math.round(rawCurrentValue);
		const computedTotal = rawCurrentValue === void 0 || usedPercent === null || usedPercent <= 0 ? void 0 : Math.round(rawCurrentValue / (usedPercent / 100));
		return {
			promptTotal: null,
			window: {
				kind: "rolling",
				label: "5h",
				quota: zaiQuota(currentValue, computedTotal, usedPercent),
				resetsAt
			}
		};
	}
	if (limit.type === "TIME_LIMIT") return {
		promptTotal: usageTotal ?? null,
		window: null
	};
	return {
		promptTotal: null,
		window: null
	};
};
const parseZaiLimits = (limits) => {
	const windows = [];
	let promptTotal = null;
	let sawTokenLimit = false;
	for (const limit of limits) {
		if (!limit.type) continue;
		const usage = zaiWindowFromLimit(limit);
		if (limit.type === "TOKENS_LIMIT") sawTokenLimit = true;
		if (usage.window) windows.push(usage.window);
		if (usage.promptTotal !== null) ({promptTotal} = usage);
	}
	if (sawTokenLimit && windows.every((window) => window.quota._tag === "Unknown")) throw new Error("invalid ZAI usage");
	return {
		promptTotal,
		windows
	};
};
/**
* Fetches and normalizes ZAI Coding Plan usage limits.
*
* Credential lookup checks, in order, the configured auth path, OpenCode auth,
* and a configured literal or environment-backed API key.
*
* @param config - Optional ZAI provider configuration.
* @param openCodeAuth - Shared OpenCode auth payload.
* @param timeoutMs - Request timeout in milliseconds.
* @returns Normalized ZAI usage data.
* @throws {Error} When no API key is available or the provider response is invalid.
*/
const fetchZaiCodingPlanUsageEffect = (config, openCodeAuth, timeoutMs) => Effect.gen(function* runFetchZaiCodingPlanUsage() {
	const environment = yield* ProviderEnvironment;
	const http = yield* ProviderHttpClient;
	const apiKey = (yield* readProviderAuthFileCredential(config?.authPath, "zai", keyFromZaiAuth)) ?? (isRecord(openCodeAuth) ? keyFromZaiAuth(openCodeAuth, environment.credential) : void 0) ?? environment.resolveCredential(config?.apiKey);
	if (!apiKey) return yield* new MissingProviderCredentialsError({
		operation: "fetch-usage",
		providerID: "zai"
	});
	const scheme = config?.authorizationScheme ?? "raw";
	const rawKey = Redacted.value(apiKey);
	const payload = yield* http.requestJson({
		headers: {
			"Accept-Language": "en-US,en",
			Authorization: scheme === "bearer" ? `Bearer ${rawKey}` : rawKey,
			"Content-Type": "application/json"
		},
		method: "GET",
		providerID: "zai",
		timeoutMs,
		url: ZAI_QUOTA_URL
	});
	const parsedPayload = isRecord(payload) ? parseZaiPayload(payload) : null;
	if (!parsedPayload) return yield* new ProviderResponseDecodeError({
		cause: "schema",
		operation: DECODE_RESPONSE_OPERATION,
		providerID: "zai"
	});
	const { limits } = parsedPayload.data;
	const { promptTotal, windows } = yield* Effect.try({
		catch: () => new ProviderResponseDecodeError({
			cause: "schema",
			operation: DECODE_RESPONSE_OPERATION,
			providerID: "zai"
		}),
		try: () => parseZaiLimits(limits)
	});
	if (!windows.some((window) => window.kind === "rolling")) return yield* new ProviderResponseDecodeError({
		cause: "schema",
		operation: DECODE_RESPONSE_OPERATION,
		providerID: "zai"
	});
	return {
		capturedAt: new Date(yield* Clock.currentTimeMillis),
		id: "zai",
		label: config?.label ?? "ZAI",
		tierName: inferZaiTier(promptTotal),
		windows
	};
});
//#endregion
//#region src/providers/index.ts
const PROVIDER_MANIFEST = {
	kimi: kimiProvider,
	codex: codexProvider,
	"opencode-go": openCodeGoProvider,
	zai: {
		defaultLabel: "ZAI",
		displayOrder: 1,
		fetch: fetchZaiCodingPlanUsageEffect,
		footerWindowKind: "rolling",
		id: "zai",
		openCodeProviderIDs: ["zai-coding-plan"]
	}
};
/** Supported providers in sidebar display order. */
const PROVIDER_ORDER = Object.values(PROVIDER_MANIFEST).toSorted((left, right) => left.displayOrder - right.displayOrder).map((provider) => provider.id);
/** Registry mapping each supported ID to its provider definition. */
const PROVIDER_REGISTRY = PROVIDER_MANIFEST;
/**
* Checks whether a runtime string names a registered provider.
*
* @param value - Candidate provider identifier.
* @returns `true` and narrows `value` when a provider is registered.
*/
const isProviderID = (value) => PROVIDER_ORDER.some((id) => id === value);
/** Provider definitions projected in sidebar display order. */
const PROVIDERS = Object.values(PROVIDER_MANIFEST).toSorted((left, right) => left.displayOrder - right.displayOrder);
/**
* Gets the provider's default display label.
*
* @param id - Registered plugin provider identifier.
* @returns Human-readable provider label.
*/
const defaultLabelFor = (id) => PROVIDER_REGISTRY[id].defaultLabel;
/**
* Maps an OpenCode provider identifier to its usage-limits adapter.
*
* @param openCodeID - Provider ID read from an OpenCode session.
* @returns Matching plugin provider ID, or `null` when unsupported.
*/
const pluginProviderForOpenCode = (openCodeID) => {
	for (const provider of PROVIDERS) if (provider.openCodeProviderIDs.some((id) => id === openCodeID)) return provider.id;
	return null;
};
//#endregion
//#region src/providers.ts
const fetchProviderEffectInternal = (id, config, openCodeAuth, timeoutMs) => Effect.suspend(() => {
	if (!isProviderID(id)) throw new Error(`unknown provider: ${id}`);
	return PROVIDER_REGISTRY[id].fetch(config, openCodeAuth, timeoutMs);
});
function fetchProviderEffect(id, config, openCodeAuth, timeoutMs) {
	return fetchProviderEffectInternal(id, config, openCodeAuth, timeoutMs);
}
/**
* Lists configured and explicitly enabled providers in display order.
*
* @param config - Fully resolved plugin configuration.
* @returns Provider IDs paired with their provider-specific configuration.
*/
const getProviderConfigs = (config) => PROVIDER_ORDER.flatMap((id) => {
	const provider = config.providers[id];
	if (provider?.enabled !== true) return [];
	return [[id, provider]];
});
//#endregion
//#region src/coordinator.ts
const intervalMilliseconds = (seconds) => Math.max(15, seconds) * 1e3;
const errorMessage = (error) => error instanceof Error ? error.message : "usage unavailable";
const errorKind = (error) => error instanceof MissingProviderCredentialsError ? error.kind : void 0;
const loadingState = (id, config) => ({
	id,
	label: config.label ?? defaultLabelFor(id),
	status: "loading"
});
const providerDisplaysFor = (providers) => Object.fromEntries(providers.map(([id, provider]) => [id, {
	footerWindow: provider.footerWindow ?? "auto",
	showFooterBar: provider.showFooterBar ?? true,
	showSidebarBar: provider.showSidebarBar ?? true,
	sidebarWindow: provider.sidebarWindow ?? "all"
}]));
const clearDisabledProviderStates = (providerIDs, lastStates, lastSuccess) => {
	for (const id of lastStates.keys()) if (!providerIDs.has(id)) {
		lastStates.delete(id);
		lastSuccess.delete(id);
	}
};
const cacheProviderStates = (states, lastStates) => {
	for (const state of states) if (state.status === "ready" || state.status === "error" && state.previous) lastStates.set(state.id, state);
};
const safePublish = (dependencies, snapshot) => Effect.suspend(() => dependencies.publish(snapshot)).pipe(Effect.catchDefect(() => Effect.void));
const safeFetchProvider = (dependencies, id, provider, auth, timeoutMs) => Effect.suspend(() => dependencies.fetchProvider(id, provider, auth, timeoutMs)).pipe(Effect.catchDefect(() => Effect.fail(new ProviderTransportError({
	cause: "unknown",
	operation: "fetch-usage",
	providerID: id
}))));
const configDiagnosticFor = (result) => {
	if (Result.isSuccess(result)) return;
	if (result.failure instanceof ConfigDecodeError) return {
		kind: "config-decode",
		message: result.failure.message
	};
	return {
		kind: "config-read",
		message: "Usage-limits config could not be read"
	};
};
/**
* Runs the recurring configuration load, provider fetch, and snapshot publish loop.
*
* Successful provider results are retained for stale-data fallback after later
* fetch failures. The returned Effect runs until interrupted.
*
* @param dependencies - Loaders, provider fetcher, clock, scheduler, and publisher.
* @returns Effect that completes only when interrupted or failed by interruption.
*/
const usageCoordinator = (dependencies) => Effect.gen(function* coordinatorLoop() {
	const lastSuccess = /* @__PURE__ */ new Map();
	const lastStates = /* @__PURE__ */ new Map();
	let lastRefreshAt = null;
	while (true) {
		const configResult = yield* dependencies.loadConfig.pipe(Effect.catchCause((cause) => Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.succeed(Result.fail(new ConfigReadError({
			cause: "filesystem",
			operation: "read-config",
			path: "usage-limits.jsonc"
		})))));
		const configDiagnostic = configDiagnosticFor(configResult);
		const config = Result.isFailure(configResult) ? DEFAULT_CONFIG : configResult.success;
		const intervalMs = intervalMilliseconds(config.refreshIntervalSeconds);
		const staleAfterMs = intervalMs * 2;
		const refreshStartedAt = yield* dependencies.now;
		const activeProviderID = dependencies.activeProviderID ? yield* dependencies.activeProviderID : void 0;
		const providers = config.enabled ? getProviderConfigs(config).filter(([id]) => activeProviderID === void 0 || id === activeProviderID) : [];
		const providerIDs = new Set(providers.map(([id]) => id));
		clearDisabledProviderStates(providerIDs, lastStates, lastSuccess);
		yield* safePublish(dependencies, {
			refreshing: true,
			diagnostics: configDiagnostic ? [configDiagnostic] : [],
			lastRefreshAt,
			providerDisplays: providerDisplaysFor(providers),
			showErrors: config.showErrors,
			states: providers.map(([id, provider]) => {
				const previous = lastStates.get(id);
				if (!previous) return loadingState(id, provider);
				if (previous.status === "ready") return {
					...previous,
					stale: refreshStartedAt.getTime() - previous.data.capturedAt.getTime() > staleAfterMs
				};
				return previous;
			})
		});
		if (providers.length > 0) {
			const authLoad = yield* dependencies.loadOpenCodeAuth.pipe(Effect.catchCause((cause) => Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.succeed({
				auth: {},
				diagnostic: {
					kind: "auth-read",
					message: "OpenCode auth could not be read"
				}
			})));
			const { auth } = authLoad;
			const terminalStates = yield* Effect.all(providers.map(([id, provider]) => Effect.match(safeFetchProvider(dependencies, id, provider, auth, config.requestTimeoutMs), {
				onFailure: (error) => ({ error }),
				onSuccess: (data) => ({ data })
			}).pipe(Effect.map((result) => {
				const label = provider.label ?? defaultLabelFor(id);
				if ("data" in result) {
					lastSuccess.set(id, result.data);
					return {
						data: result.data,
						id,
						label,
						stale: false,
						status: "ready"
					};
				}
				const previous = lastSuccess.get(id);
				const state = {
					errorKind: errorKind(result.error),
					id,
					label,
					message: errorMessage(result.error),
					status: "error"
				};
				if (previous) return {
					...state,
					previous
				};
				return state;
			}))), { concurrency: "unbounded" });
			const now = yield* dependencies.now;
			lastRefreshAt = now;
			const states = terminalStates.map((state) => state.status === "ready" ? {
				...state,
				stale: now.getTime() - state.data.capturedAt.getTime() > staleAfterMs
			} : state);
			cacheProviderStates(states, lastStates);
			yield* safePublish(dependencies, {
				refreshing: false,
				diagnostics: authLoad.diagnostic ? [authLoad.diagnostic] : [],
				lastRefreshAt: now,
				providerDisplays: providerDisplaysFor(providers),
				showErrors: config.showErrors,
				states
			});
		} else {
			lastRefreshAt = null;
			yield* safePublish(dependencies, {
				refreshing: false,
				diagnostics: configDiagnostic ? [configDiagnostic] : [],
				lastRefreshAt: null,
				providerDisplays: {},
				showErrors: config.showErrors,
				states: []
			});
		}
		yield* dependencies.sleep(intervalMs);
	}
});
//#endregion
//#region src/session.ts
const windowFromState = (state) => {
	if (!state) return;
	if (state.status === "ready") return state.data;
	if (state.status === "error") return state.previous;
};
/**
* Selects the usage window that should be shown in the prompt footer.
*
* OpenCode provider IDs are mapped to this plugin's provider IDs, then the most
* useful window is selected from the current provider state. If the latest fetch
* failed, the last successful data attached to the error state is used.
*
* @param states - Current provider states maintained by the plugin.
* @param providerID - OpenCode provider identifier for the active session.
* @returns The best usage window for the active provider, or `null` if none can
*   be shown.
*/
const selectUsageForProvider = (states, providerID, providerDisplays = {}) => {
	const usageID = providerID ? pluginProviderForOpenCode(providerID) : null;
	const resolveWindow = (id) => {
		const state = states.find((item) => item.id === id);
		const data = windowFromState(state);
		if (!data) return null;
		const requestedWindow = providerDisplays[id]?.footerWindow ?? "auto";
		const footerWindowKind = PROVIDER_REGISTRY[id]?.footerWindowKind;
		const findForKind = (kind) => (kind === "rolling" ? data.windows.find((window) => window.label === "5h") : void 0) ?? data.windows.find((window) => window.kind === kind);
		const requested = findForKind(requestedWindow === "auto" ? footerWindowKind : requestedWindow);
		if (requested) return requested;
		if (requestedWindow !== "auto") {
			const footer = findForKind(footerWindowKind);
			if (footer) return footer;
		}
		return data.windows[0] ?? null;
	};
	if (!usageID) return null;
	const window = resolveWindow(usageID);
	return window ? {
		providerID: usageID,
		window
	} : null;
};
/**
* Resolves the plugin provider that supplies usage for the active session.
*
* @param states - Latest state for each configured provider.
* @param providerID - OpenCode provider ID associated with the session.
* @param providerDisplays - Optional per-provider footer window preferences.
* @returns Matching plugin provider ID, or `null` if usage is unavailable.
*/
const usageProviderFor = (states, providerID, providerDisplays = {}) => selectUsageForProvider(states, providerID, providerDisplays)?.providerID ?? null;
/**
* Selects the active provider's preferred usage window for the footer.
*
* @param states - Latest state for each configured provider.
* @param providerID - OpenCode provider ID associated with the session.
* @param providerDisplays - Optional per-provider footer window preferences.
* @returns Selected quota window, or `null` when no window can be shown.
*/
const usageForProvider = (states, providerID, providerDisplays = {}) => selectUsageForProvider(states, providerID, providerDisplays)?.window ?? null;
//#endregion
//#region src/plugin.tsx
const SIDEBAR_SLOT = "sidebar.content";
const FOOTER_SLOT = "prompt.footer.status";
/**
* Creates provider runtime dependencies backed by the production services.
*
* @param loaders - Optional configuration and auth loader overrides.
* @returns Dependencies using production HTTP and filesystem services.
*/
const makeProductionDependencies = (loaders) => {
	const selectedLoaders = loaders ?? {
		loadConfig,
		loadOpenCodeAuth
	};
	return {
		fetchProvider: (id, config, auth, timeoutMs) => fetchProviderEffect(id, config, auth, timeoutMs).pipe(Effect.provide(ProviderRuntimeLive)),
		loadConfig: selectedLoaders.loadConfig,
		loadOpenCodeAuth: selectedLoaders.loadOpenCodeAuth,
		now: () => /* @__PURE__ */ new Date()
	};
};
const productionDependencies = makeProductionDependencies();
/**
* Creates the OpenCode TUI plugin with explicit runtime dependencies.
*
* The plugin periodically loads configuration, fetches the active provider's usage,
* stores the latest successful result for stale/error fallback, and registers UI
* slots for both the sidebar panel and prompt-footer indicator.
*
* @param dependencies - Runtime loaders, provider fetcher, scheduler, and clock.
* @returns A setup function that registers slots and starts the refresh loop.
*/
const createUsageLimitsPlugin = (dependencies) => (context) => {
	let disposed = false;
	const refreshRequests = Effect.runSync(Queue.sliding(1));
	const requestRefresh = () => {
		if (!disposed) Queue.offerUnsafe(refreshRequests, void 0);
	};
	const activeProvider = () => {
		const providerID = context.ui.model.current()?.providerID;
		return providerID ? pluginProviderForOpenCode(providerID) : null;
	};
	let previousProvider = activeProvider();
	const disposeWatcher = createRoot((dispose) => {
		createEffect(() => {
			const provider = activeProvider();
			if (provider !== previousProvider) {
				previousProvider = provider;
				requestRefresh();
			}
		});
		return dispose;
	});
	const [snapshot, setSnapshot] = createSignal({
		refreshing: false,
		diagnostics: [],
		lastRefreshAt: null,
		providerDisplays: {},
		showErrors: true,
		states: []
	});
	const disposeSidebar = context.ui.slot({
		append: SIDEBAR_SLOT,
		render: () => /* @__PURE__ */ jsx(Show, {
			when: snapshot(),
			keyed: true,
			children: (current) => /* @__PURE__ */ jsx(UsageLimitsPanel, {
				diagnostics: current.diagnostics,
				providerDisplays: current.providerDisplays,
				showErrors: current.showErrors,
				states: current.states,
				theme: context.theme,
				lastRefreshAt: current.lastRefreshAt
			})
		})
	});
	const disposeFooter = context.ui.slot({
		append: FOOTER_SLOT,
		render: (slot) => {
			if (!slot.sessionID || slot.mode === "shell") return null;
			const providerID = () => context.ui.model.current()?.providerID;
			const display = () => {
				const id = usageProviderFor(snapshot().states, providerID(), snapshot().providerDisplays);
				return id ? snapshot().providerDisplays[id] : void 0;
			};
			return /* @__PURE__ */ jsx(BottomUsage, {
				theme: context.theme,
				showBar: display()?.showFooterBar !== false,
				window: usageForProvider(snapshot().states, providerID(), snapshot().providerDisplays)
			});
		}
	});
	const coordinator = usageCoordinator({
		activeProviderID: Effect.sync(activeProvider),
		fetchProvider: dependencies.fetchProvider,
		loadConfig: Effect.promise(() => dependencies.loadConfig()),
		loadOpenCodeAuth: Effect.promise(() => dependencies.loadOpenCodeAuth()),
		now: Effect.sync(dependencies.now),
		publish: (nextSnapshot) => Effect.sync(() => setSnapshot(nextSnapshot)),
		sleep: (milliseconds) => Effect.raceFirst(dependencies.sleep?.(milliseconds) ?? Effect.sleep(milliseconds), Queue.take(refreshRequests))
	});
	const fiber = Effect.runFork(Effect.scoped(coordinator));
	context.keymap.layer(() => ({
		mode: "global",
		commands: [{
			id: "usage-limits.refresh",
			title: "Refresh usage limits",
			palette: true,
			slash: { name: "limits" },
			run: () => {
				if (disposed) return;
				requestRefresh();
				context.ui.dialog.show(() => /* @__PURE__ */ jsxs("box", {
					flexDirection: "column",
					children: [/* @__PURE__ */ jsx(Show, {
						when: snapshot(),
						keyed: true,
						children: (current) => /* @__PURE__ */ jsxs(Fragment, { children: [
							current.refreshing ? /* @__PURE__ */ jsx("text", { children: "Refreshing limits..." }) : null,
							/* @__PURE__ */ jsx(UsageLimitsPanel, {
								diagnostics: [...current.diagnostics, ...current.states.flatMap((state) => state.status === "error" && state.errorKind === "missing_credentials" ? [{
									kind: "auth-missing",
									message: state.message
								}] : [])],
								states: current.states,
								providerDisplays: current.providerDisplays,
								showErrors: true,
								theme: context.theme,
								lastRefreshAt: current.lastRefreshAt
							}),
							!current.refreshing && current.states.length === 0 && current.diagnostics.length === 0 ? /* @__PURE__ */ jsx("text", { children: "No enabled usage provider for the selected model." }) : null
						] })
					}), /* @__PURE__ */ jsx("text", { children: "Escape to close. Not added to the conversation." })]
				}));
			}
		}]
	}));
	return () => {
		if (disposed) return;
		disposed = true;
		disposeWatcher();
		disposeSidebar();
		disposeFooter();
		Effect.runFork(Fiber.interrupt(fiber));
	};
};
/** OpenCode v2 plugin setup using production runtime dependencies. */
const setupUsageLimitsPlugin = createUsageLimitsPlugin(productionDependencies);
//#endregion
//#region src/index.ts
var src_default = Plugin.define({
	id: "sakateka.usage-limits",
	setup: setupUsageLimitsPlugin
});
//#endregion
export { src_default as default };
