import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import admin from './routes/admin.js';
import auth from './routes/auth.js';
import bookings from './routes/bookings.js';
import classes from './routes/classes.js';
import memberships from './routes/memberships.js';
import notifications from './routes/notifications.js';
import plans from './routes/plans.js';
import reports from './routes/reports.js';
import trainer from './routes/trainer.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.clientOrigins }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', auth);
  app.use('/api/plans', plans);
  app.use('/api/memberships', memberships);
  app.use('/api/classes', classes);
  app.use('/api/bookings', bookings);
  app.use('/api/trainer', trainer);
  app.use('/api/admin', admin);
  app.use('/api/notifications', notifications);
  app.use('/api/reports', reports);
  app.use('/api', notFoundHandler);

  // Production: serve the built React app from the same origin (run `npm run build` first).
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
