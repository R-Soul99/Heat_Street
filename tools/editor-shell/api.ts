/** Fetch wrappers whose errors carry the server's own message (D-03). DOM-free. */

const MAX_BODY = 200;

export function errorFromResponse(status: number, bodyText: string, url: string): Error {
  const trimmed = bodyText.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        const e = (parsed as { error: unknown }).error;
        if (typeof e === "string" && e.length > 0) return new Error(e);
      }
    } catch {
      // not JSON after all; fall through to the generic message
    }
  }
  const base = `${url} failed (${status})`;
  return new Error(trimmed ? `${base}: ${trimmed.slice(0, MAX_BODY)}` : base);
}

async function request(url: string, init?: RequestInit): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error(`Could not reach the dev server (${url}). Is npm run dev running?`);
  }
  const text = await res.text();
  if (!res.ok) throw errorFromResponse(res.status, text, url);
  return text;
}

export async function apiText(url: string, init?: RequestInit): Promise<string> {
  return request(url, init);
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const text = await request(url, init);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${url} returned a response that is not valid JSON`);
  }
}
