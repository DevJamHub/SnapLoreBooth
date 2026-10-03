/**
 * Reads a JSON reply, or explains one that is not JSON. A tunnel or proxy in front of the
 * booth can answer with its own HTML error page, and "Unexpected token '<'" helps nobody.
 */
export async function readJson<T extends object>(res: Response): Promise<T & { error?: string }> {
  try {
    return (await res.json()) as T & { error?: string };
  } catch {
    return { error: `The server answered HTTP ${res.status} without data (a tunnel or proxy error page). Try again.` } as T & {
      error?: string;
    };
  }
}
