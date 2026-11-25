/**
 * Parses a platform response body. Returns `{}` for 204 and `null` when the body is empty or not JSON
 * (HTML error pages from CDNs/proxies), so callers can report a clear error instead of a SyntaxError.
 */
export async function readJsonSafely(response) {
  if (response.status === 204) return {};
  try {
    return await response.json();
  } catch {
    return null;
  }
}
