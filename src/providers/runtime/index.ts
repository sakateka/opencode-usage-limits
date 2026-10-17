import { Layer } from "effect";

import type { ProviderEnvironment } from "@/providers/runtime/environment.ts";
import { ProviderEnvironmentLive } from "@/providers/runtime/environment.ts";
import type { ProviderFileSystem } from "@/providers/runtime/filesystem.ts";
import { ProviderFileSystemLive } from "@/providers/runtime/filesystem.ts";
import type { ProviderHttpClient } from "@/providers/runtime/http.ts";
import { ProviderHttpClientLive } from "@/providers/runtime/http.ts";

/** Runtime services required by every provider definition. */
export type ProviderRuntime =
  | ProviderEnvironment
  | ProviderFileSystem
  | ProviderHttpClient;

/**
 * Production provider runtime layer composed from the live platform services.
 *
 * Provides environment, filesystem, and HTTP capabilities required by provider
 * adapters.
 */
export const ProviderRuntimeLive = Layer.mergeAll(
  ProviderEnvironmentLive,
  ProviderFileSystemLive,
  ProviderHttpClientLive
);
