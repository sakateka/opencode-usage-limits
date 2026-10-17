import { vi } from "vitest";

const originalFetch = globalThis.fetch;

type FetchMock = (
  url: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export const installFetchMock = (response: Response) => {
  const fetchMock = vi.fn<FetchMock>(() => Promise.resolve(response));
  globalThis.fetch = fetchMock;

  return fetchMock;
};

export const resetFetchMock = () => {
  globalThis.fetch = originalFetch;
  delete process.env.OC_USAGE_LIMITS_ZAI_KEY;
  vi.restoreAllMocks();
};
