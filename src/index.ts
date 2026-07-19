import { loadConfig } from './config/env.js';
import { initLogger, getLogger } from './core/logger.js';
import { initCache } from './core/cache.js';
import { buildServer } from './server.js';
import { registerScenarios } from './scenarios/index.js';

async function main(): Promise<void> {
  try {
    const config = loadConfig();
    initLogger(config.LOG_LEVEL);
    initCache();

    const app = await buildServer();

    await registerScenarios(app);

    await app.listen({ port: config.PORT, host: config.HOST });

    getLogger().info(`Server listening on http://${config.HOST}:${config.PORT}`);
    getLogger().info('API docs available at http://{HOST}:{PORT}/docs');
  } catch (error) {
    getLogger().error(error);
    process.exit(1);
  }
}

main();
