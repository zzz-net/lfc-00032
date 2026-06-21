import app from './app.js';
import net from 'net';

const HOST = process.env.HOST || '127.0.0.1';
const START_PORT = Number(process.env.PORT) || 51876;
const MAX_PORT_TRIES = 100;

const findFreePort = (startPort: number, host: string, tries: number = 0): Promise<number> => {
  return new Promise((resolve, reject) => {
    if (tries >= MAX_PORT_TRIES) {
      reject(new Error(`No free port found after ${MAX_PORT_TRIES} attempts`));
      return;
    }
    const port = startPort + tries;
    const server = net.createServer();
    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findFreePort(startPort, host, tries + 1));
      } else {
        reject(err);
      }
    });
    server.once('listening', () => {
      server.close(() => resolve(port));
    });
    server.listen(port, host);
  });
};

let server: any;

const start = async () => {
  const port = await findFreePort(START_PORT, HOST);
  server = app.listen(port, HOST, () => {
    console.log('========================================');
    console.log(`🚀 Server ready on http://${HOST}:${port}`);
    console.log(`📁 API base:  http://${HOST}:${port}/api`);
    console.log(`💾 Health:    http://${HOST}:${port}/api/health`);
    console.log('========================================');
    (globalThis as any).__SERVER_PORT__ = port;
    (globalThis as any).__SERVER_HOST__ = HOST;
  });
};

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  if (server) server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  if (server) server.close(() => process.exit(0));
});

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
