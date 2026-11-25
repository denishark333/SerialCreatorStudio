/** Public backend address only. Provider secrets stay on the VPS. */
export const apiBase = (
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL || 'http://localhost:4000'
).replace(/\/+$/, '');
