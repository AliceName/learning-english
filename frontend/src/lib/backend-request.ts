import "server-only";

// Allow time to step through the API in Visual Studio. In production, keep the
// deadline above a SQL connection (5s) + two auth commands (10s each), with margin.
const backendTimeoutMs = process.env.NODE_ENV === "development" ? 120_000 : 30_000;

export function backendRequestSignal(requestSignal?: AbortSignal) {
  const timeout = AbortSignal.timeout(backendTimeoutMs);
  return requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
}

export function isBackendTimeout(error: unknown) {
  return error instanceof Error && error.name === "TimeoutError";
}
