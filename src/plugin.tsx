/* @jsxImportSource @opentui/solid */
import type { JSX } from "@opentui/solid";
import { Effect, Fiber, Queue } from "effect";
import { createEffect, createRoot, createSignal, Show } from "solid-js";

import { BottomUsage, UsageLimitsPanel } from "@/components.tsx";
import type { UsageTheme } from "@/components.tsx";
import { loadConfig, loadOpenCodeAuth } from "@/config.ts";
import type { CoordinatorSnapshot } from "@/coordinator.ts";
import { usageCoordinator } from "@/coordinator.ts";
import type { ProviderError } from "@/errors.ts";
import { fetchProviderEffect } from "@/providers.ts";
import { ProviderRuntimeLive } from "@/providers/runtime/index.ts";
import { pluginProviderForOpenCode } from "@/providers/index.ts";
import { usageForProvider, usageProviderFor } from "@/session.ts";
import type {
  ProviderID,
  OpenCodeAuth,
  ProviderConfigMap,
  ProviderUsage,
} from "@/types.ts";

const SIDEBAR_SLOT = "sidebar.content" as const;
const FOOTER_SLOT = "prompt.footer.status" as const;

/** Runtime dependencies used by the usage-limits TUI lifecycle. */
export interface UsageLimitsTuiDependencies {
  /** Fetches one configured provider's usage. */
  fetchProvider: <ID extends ProviderID>(
    id: ID,
    config: ProviderConfigMap[ID] | undefined,
    openCodeAuth: OpenCodeAuth,
    timeoutMs: number
  ) => Effect.Effect<ProviderUsage<ID>, ProviderError>;
  /** Loads the fully resolved plugin configuration. */
  loadConfig: () => Promise<Awaited<ReturnType<typeof loadConfig>>>;
  /** Loads shared OpenCode provider authentication. */
  loadOpenCodeAuth: () => Promise<Awaited<ReturnType<typeof loadOpenCodeAuth>>>;
  /** Returns the current wall-clock time. */
  now: () => Date;
  /** Suspends the coordinator until its next refresh. */
  sleep?: (milliseconds: number) => Effect.Effect<void>;
}

export interface UsageLimitsSlotContext {
  /** Active session identifier, when a session is selected. */
  readonly sessionID?: string;
  /** Composer mode; shell mode does not show the usage footer. */
  readonly mode?: "normal" | "shell";
}

interface UsageLimitsSlotClaim {
  readonly append: typeof SIDEBAR_SLOT | typeof FOOTER_SLOT;
  readonly render: (slot: UsageLimitsSlotContext) => JSX.Element | null;
}

export interface UsageLimitsContext {
  readonly keymap: {
    readonly layer: (factory: () => {
      mode: "global";
      commands: readonly {
        id: string;
        title: string;
        palette: true;
        slash: { name: string };
        run: () => void;
      }[];
    }) => void;
  };
  /** Current OpenCode theme used by plugin UI components. */
  readonly theme: UsageTheme;
  /** Registers UI contributions and returns a disposer for each slot. */
  readonly ui: {
    readonly model: {
      readonly current: () => { readonly providerID: string } | undefined;
    };
    readonly dialog: {
      readonly show: (render: () => JSX.Element) => void;
    };
    readonly slot: (claim: UsageLimitsSlotClaim) => () => void;
  };
}

/**
 * Creates provider runtime dependencies backed by the production services.
 *
 * @param loaders - Optional configuration and auth loader overrides.
 * @returns Dependencies using production HTTP and filesystem services.
 */
export const makeProductionDependencies = (
  loaders?: Pick<UsageLimitsTuiDependencies, "loadConfig" | "loadOpenCodeAuth">
): UsageLimitsTuiDependencies => {
  const selectedLoaders = loaders ?? { loadConfig, loadOpenCodeAuth };

  return {
    fetchProvider: (id, config, auth, timeoutMs) =>
      fetchProviderEffect(id, config, auth, timeoutMs).pipe(
        Effect.provide(ProviderRuntimeLive)
      ),
    loadConfig: selectedLoaders.loadConfig,
    loadOpenCodeAuth: selectedLoaders.loadOpenCodeAuth,
    now: () => new Date(),
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
export const createUsageLimitsPlugin =
  (dependencies: UsageLimitsTuiDependencies) =>
  (context: UsageLimitsContext): (() => void) => {
    let disposed = false;
    const refreshRequests = Effect.runSync(Queue.sliding<void>(1));
    const requestRefresh = () => {
      if (!disposed) {
        Queue.offerUnsafe(refreshRequests, undefined);
      }
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
    const [snapshot, setSnapshot] = createSignal<CoordinatorSnapshot>({
      refreshing: false,
      diagnostics: [],
      lastRefreshAt: null,
      providerDisplays: {},
      showErrors: true,
      states: [],
    });

    const disposeSidebar = context.ui.slot({
      append: SIDEBAR_SLOT,
      render: () => (
        <Show when={snapshot()} keyed>
          {(current) => (
            <UsageLimitsPanel
              diagnostics={current.diagnostics}
              providerDisplays={current.providerDisplays}
              showErrors={current.showErrors}
              states={current.states}
              theme={context.theme}
              lastRefreshAt={current.lastRefreshAt}
            />
          )}
        </Show>
      ),
    });

    const disposeFooter = context.ui.slot({
      append: FOOTER_SLOT,
      render: (slot) => {
        if (!slot.sessionID || slot.mode === "shell") {
          return null;
        }

        const providerID = () => context.ui.model.current()?.providerID;

        const display = () => {
          const id = usageProviderFor(
            snapshot().states,
            providerID(),
            snapshot().providerDisplays
          );
          return id ? snapshot().providerDisplays[id] : undefined;
        };

        return (
          <BottomUsage
            theme={context.theme}
            showBar={display()?.showFooterBar !== false}
            window={usageForProvider(
              snapshot().states,
              providerID(),
              snapshot().providerDisplays
            )}
          />
        );
      },
    });

    const coordinator = usageCoordinator({
      activeProviderID: Effect.sync(activeProvider),
      fetchProvider: dependencies.fetchProvider,
      loadConfig: Effect.promise(() => dependencies.loadConfig()),
      loadOpenCodeAuth: Effect.promise(() => dependencies.loadOpenCodeAuth()),
      now: Effect.sync(dependencies.now),
      publish: (nextSnapshot) => Effect.sync(() => setSnapshot(nextSnapshot)),
      sleep: (milliseconds) =>
        Effect.raceFirst(
          dependencies.sleep?.(milliseconds) ?? Effect.sleep(milliseconds),
          Queue.take(refreshRequests)
        ),
    });

    const fiber = Effect.runFork(Effect.scoped(coordinator));

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "usage-limits.refresh",
          title: "Refresh usage limits",
          palette: true,
          slash: { name: "limits" },
          run: () => {
            if (disposed) {
              return;
            }
            requestRefresh();
            context.ui.dialog.show(() => (
              <box flexDirection="column">
                <Show when={snapshot()} keyed>
                  {(current) => (
                    <>
                      {current.refreshing ? (
                        <text>Refreshing limits...</text>
                      ) : null}
                      <UsageLimitsPanel
                        diagnostics={[
                          ...current.diagnostics,
                          ...current.states.flatMap((state) =>
                            state.status === "error" &&
                            state.errorKind === "missing_credentials"
                              ? [{
                                  kind: "auth-missing" as const,
                                  message: state.message,
                                }]
                              : []
                          ),
                        ]}
                        states={current.states}
                        providerDisplays={current.providerDisplays}
                        showErrors={true}
                        theme={context.theme}
                        lastRefreshAt={current.lastRefreshAt}
                      />
                      {!current.refreshing &&
                      current.states.length === 0 &&
                      current.diagnostics.length === 0 ? (
                        <text>No enabled usage provider for the selected model.</text>
                      ) : null}
                    </>
                  )}
                </Show>
                <text>Escape to close. Not added to the conversation.</text>
              </box>
            ));
          },
        },
      ],
    }));

    return () => {
      if (disposed) {
        return;
      }
      disposed = true;
      disposeWatcher();
      disposeSidebar();
      disposeFooter();
      Effect.runFork(Fiber.interrupt(fiber));
    };
  };

/** OpenCode v2 plugin setup using production runtime dependencies. */
export const setupUsageLimitsPlugin = createUsageLimitsPlugin(
  productionDependencies
);
