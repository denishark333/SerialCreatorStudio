export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}
/**
 * Errors caused by a platform (YouTube, Twitch, Kick) use 424 Failed Dependency, never 502/504: Cloudflare replaces
 * 502/504 responses from the origin with its own page (no CORS headers), and the dashboard would only see a generic
 * "backend unavailable" instead of the platform's reason.
 */
export const fail = (status, code, message, details) => {
  throw new ApiError(status, code, message, details);
};
export function dateOnly(value, name) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail(400, 'INVALID_DATE', `${name} deve ser uma data válida YYYY-MM-DD.`);
  return value;
}
export function objectBody(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'INVALID_BODY', 'Envie um objeto JSON.');
  const unknown = Object.keys(value).filter(k => !allowed.includes(k));
  if (unknown.length) fail(400, 'UNKNOWN_FIELDS', 'Campos não reconhecidos.', unknown);
}
export function text(value, name, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    fail(400, 'INVALID_FIELD', `${name} deve ter entre 1 e ${max} caracteres.`);
  return value.trim();
}
export function member(value, values, name) {
  if (!values.includes(value)) fail(400, 'INVALID_FIELD', `${name} inválido.`, { allowed: values });
  return value;
}
