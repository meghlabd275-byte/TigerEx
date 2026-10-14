/**
 * Legacy TypeScript API entrypoint.
 *
 * Trading, wallet, custody, identity, and admin routes must be served by the
 * authenticated Go services. This file intentionally exposes no business
 * operations because the previous implementation returned fabricated health
 * and accepted unauthenticated state-changing requests.
 */
import express from 'express';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

app.get('/health/live', (_req, res) => {
  res.status(200).json({ status: 'alive' });
});

app.get('/health/ready', (_req, res) => {
  res.status(503).json({
    status: 'not_ready',
    reason: 'The legacy TypeScript API has no configured persistence, authentication verifier, or trading service.',
  });
});

app.use('/api', (_req, res) => {
  res.status(503).json({
    error: {
      code: 'SERVICE_NOT_CONFIGURED',
      message: 'This legacy API entrypoint does not serve exchange operations.',
    },
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

export default app;
