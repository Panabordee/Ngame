import { server } from "./app.config.ts";
import { loadServerConfig } from "./config.ts";

const config = loadServerConfig();
await server.listen(config.port, config.hostname);
