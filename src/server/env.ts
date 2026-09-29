// Server-only: reads Worker secrets and vars.
//
// Cloudflare passes bindings as the `env` argument, but TanStack Start's
// fetch is reached through Nitro without it. Nitro stores the same object on
// globalThis.__env__, and nodejs_compat mirrors secrets into process.env
// (which is also where `vite dev` puts .env values), so each is tried in turn.
export function readEnv(env: unknown, name: string): string | undefined {
  const sources = [env, (globalThis as { __env__?: unknown }).__env__];
  for (const source of sources) {
    if (source && typeof source === "object") {
      const value = (source as Record<string, unknown>)[name];
      if (typeof value === "string" && value) return value;
    }
  }
  if (typeof process !== "undefined" && process.env) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}
