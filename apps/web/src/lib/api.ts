import type { ApiError } from "@torra/shared";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: { path: string; problem: string }[] = [],
  ) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** JSON in, JSON out, through the web app's own /api (the server's cookie is first-party). */
export async function api<T>(
  path: string,
  init: { method?: Method; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch {
    throw new ApiFailure(0, "network", "Sem conexão com o servidor. Tente de novo.");
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as T | ApiError | null;
  if (!response.ok) {
    const error = (body as ApiError | null)?.error;
    throw new ApiFailure(
      response.status,
      error?.code ?? "unknown",
      // A proxy error page while the free instance wakes up has no JSON body.
      error?.message ??
        (response.status >= 500
          ? "O servidor está acordando. Tente de novo em instantes."
          : "Algo deu errado."),
      error?.fields,
    );
  }
  return body as T;
}
