import { createApp } from "./bootstrap.ts";
import { loadEnv } from "./env.ts";

const env = loadEnv();
const app = await createApp(env);
await app.listen({ port: env.PORT, host: env.HOST });
