// Thin Worker entry: vinext handles /api/*; cron hits the same requeue route.
import vinextHandler from "vinext/server/fetch-handler";

type Env = { CRON_SECRET?: string };

const handler = vinextHandler as ExportedHandler<Env>;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return handler.fetch!(request, env, ctx);
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const secret = env.CRON_SECRET?.trim();
    if (!secret) return;
    // Self-dispatch so /api/cron/requeue keeps the Bearer check in one place.
    ctx.waitUntil(
      Promise.resolve(
        handler.fetch!(
          new Request("http://atelier-api/api/cron/requeue", {
            method: "POST",
            headers: { authorization: `Bearer ${secret}` },
          }),
          env,
          ctx,
        ),
      ).then(() => undefined),
    );
  },
};
