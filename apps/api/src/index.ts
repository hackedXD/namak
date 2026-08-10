// Cloudflare Worker entry. The D1 binding satisfies the @salt/db D1Like port
// directly, so the same repos used in tests run here against real D1.
import { createApp } from './app.js';
import { D1FormulationRepo, D1MetaRepo, type D1Like } from '@salt/db';
import { DEFAULT_CHANNEL_TIER } from './deps.js';

export interface Env {
  DB: D1Like;
}

// Minimal shape of the Workers ExecutionContext (avoids a types dependency).
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export default {
  fetch(request: Request, env: Env, _ctx: ExecutionContext): Response | Promise<Response> {
    const app = createApp({
      formulationRepo: new D1FormulationRepo(env.DB),
      metaRepo: new D1MetaRepo(env.DB),
      channelTier: DEFAULT_CHANNEL_TIER,
      now: () => new Date().toISOString(),
    });
    // Hono manages its own execution context; we don't use waitUntil here.
    return app.fetch(request, env);
  },
};
