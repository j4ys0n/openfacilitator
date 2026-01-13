import 'dotenv/config';
import { createServer } from './server.js';
import { initializeDatabase } from './db/index.js';
import { initializeAuth } from './auth/index.js';
import { logger } from './utils/logger.js';

const PORT = parseInt(process.env.PORT || '5002', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATABASE_PATH = process.env.DATABASE_PATH || './data/openfacilitator.db';

async function main() {
  logger.server.info('Starting OpenFacilitator server', {
    port: PORT,
    host: HOST,
    env: process.env.NODE_ENV || 'development',
    databasePath: DATABASE_PATH,
  });

  // Initialize database
  initializeDatabase(DATABASE_PATH);
  logger.server.info('Database initialized', { path: DATABASE_PATH });

  // Initialize auth
  initializeAuth(DATABASE_PATH);
  logger.server.info('Authentication initialized');

  // Create and start server
  const app = createServer();

  app.listen(PORT, HOST, () => {
    logger.server.info('Server started successfully', {
      url: `http://${HOST}:${PORT}`,
      port: PORT,
      host: HOST,
    });
    console.log(`🚀 OpenFacilitator server running at http://${HOST}:${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Database: ${DATABASE_PATH}`);
  });
}

main().catch((error) => {
  logger.server.error('Failed to start server', {}, error instanceof Error ? error : new Error(String(error)));
  console.error('Failed to start server:', error);
  process.exit(1);
});

export { createServer } from './server.js';
export * from './db/index.js';
export * from './auth/index.js';

