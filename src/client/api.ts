export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (csrfToken && unsafeMethods.has(method) && !headers.has("X-CSRF-Token")) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin"
  });

  let parsedBody: unknown = null;
  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = null;
  }

  if (!response.ok) {
    let message = response.statusText;
    if (hasErrorMessage(parsedBody)) {
      message = parsedBody.error;
    }
    throw new ApiError(message, response.status);
  }

  if (hasCsrfToken(parsedBody)) {
    csrfToken = parsedBody.csrfToken;
  }

  return parsedBody as T;
}

function hasErrorMessage(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === "object" && "error" in value && typeof value.error === "string");
}

function hasCsrfToken(value: unknown): value is { csrfToken: string } {
  return Boolean(
    value && typeof value === "object" && "csrfToken" in value && typeof value.csrfToken === "string"
  );
}
