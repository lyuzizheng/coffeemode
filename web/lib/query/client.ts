import { QueryClient, isServer } from "@tanstack/react-query";
import { shouldRetryQuery } from "./retry";

const STALE_TIME_MS = 1000 * 60 * 5; // 5 minutes
const GC_TIME_MS = 1000 * 60 * 60 * 24; // 24 hours

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        gcTime: GC_TIME_MS,
        networkMode: "offlineFirst",
        retry: (failureCount) =>
          shouldRetryQuery(
            failureCount,
            typeof navigator === "undefined" ? true : navigator.onLine,
          ),
      },
      mutations: {
        networkMode: "offlineFirst",
        retry: 0,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * Returns a singleton QueryClient on the browser, or a fresh one on the server.
 */
export function getQueryClient(): QueryClient {
  if (isServer) {
    return makeQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}
