// Cloudflare Pages runs this for every /api/* request; the static site is
// served as before. The D1 database is bound as DB in the Pages project settings.
import { handle } from "hono/cloudflare-pages";
import { app } from "../../src/worker/index";

export const onRequest = handle(app);
