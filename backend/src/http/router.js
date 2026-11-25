/**
 * Ordered route table. Entries are evaluated top to bottom and the first match
 * handles the request, so order expresses precedence explicitly.
 *
 * - `route(method, pattern, handler, { when })`
 *   method:  'GET' | 'POST' | ... | an array of methods
 *   pattern: exact string or RegExp (capture groups are passed to the handler)
 *   when:    optional predicate on the request context, checked after matching
 * - `middleware(fn)` runs for every request that reaches it and never ends dispatch.
 */
export function route(method, pattern, handler, { when } = {}) {
  return { methods: Array.isArray(method) ? method : [method], pattern, handler, when };
}

export function middleware(handler) {
  return { middleware: handler };
}

function match(pattern, target) {
  if (typeof pattern === 'string') return pattern === target ? [] : null;
  const result = target.match(pattern);
  return result ? result.slice(1) : null;
}

/** Returns true when a route handled the request. */
export async function dispatch(routes, ctx, target) {
  for (const entry of routes) {
    if (entry.middleware) {
      await entry.middleware(ctx);
      continue;
    }
    if (!entry.methods.includes(ctx.method)) continue;
    const params = match(entry.pattern, target);
    if (!params || (entry.when && !entry.when(ctx))) continue;
    await entry.handler(ctx, ...params);
    return true;
  }
  return false;
}
