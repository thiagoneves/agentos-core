import { DashboardServer } from '../core/server.js';

export const monitorCommand = async (options: { port?: string }) => {
  const port = parseInt(options.port || '3000');
  const server = new DashboardServer(port);
  server.start();
};
