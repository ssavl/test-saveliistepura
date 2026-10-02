import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { validateConfig } from '@funnel/shared';
import { z, ZodError } from 'zod';
import { computeAnalytics } from './analytics';
import type { Db } from './db';
import { ingestEvents } from './ingest';
import {
  CreateSessionBody,
  createOrResumeSession,
  getResult,
  getSession,
  UpdateStateBody,
  updateState,
} from './sessions';
import { funnelAdmin, getVersionConfig, HttpError, listFunnels, publishVersion, rollback } from './versions';

export interface AppOptions {
  db: Db;
  configsDir?: string;
  webDir?: string;
  adminToken?: string;
  logger?: boolean;
}

export function buildApp({ db, configsDir, webDir, adminToken, logger = false }: AppOptions) {
  const app = Fastify({ logger, bodyLimit: 1024 * 1024 });

  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-headers', 'content-type, x-admin-token');
    reply.header('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
    if (req.method === 'OPTIONS') return reply.code(204).send();
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send(err.body ?? { error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Bad request', issues: err.issues });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    app.log.error(err);
    return reply.code(500).send({ error: 'Internal error' });
  });

  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (adminToken && req.headers['x-admin-token'] !== adminToken) {
      return reply.code(401).send({ error: 'Admin token required' });
    }
  };

  app.get('/api/health', async () => ({ ok: true }));

  app.post('/api/sessions', async (req) => createOrResumeSession(db, CreateSessionBody.parse(req.body)));
  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req) => getSession(db, req.params.id));
  app.get<{ Params: { id: string } }>('/api/sessions/:id/result', async (req) => getResult(db, req.params.id));
  app.put<{ Params: { id: string } }>('/api/sessions/:id/state', async (req) =>
    updateState(db, req.params.id, UpdateStateBody.parse(req.body)),
  );
  app.post('/api/events', async (req) => ingestEvents(db, (req.body as { events?: unknown } | null)?.events));

  app.register(async (admin) => {
    admin.addHook('onRequest', requireAdmin);
    admin.get('/api/admin/funnels', async () => listFunnels(db));
    admin.get<{ Params: { slug: string } }>('/api/admin/funnels/:slug', async (req) => funnelAdmin(db, req.params.slug));
    admin.get<{ Params: { slug: string; version: string } }>(
      '/api/admin/funnels/:slug/versions/:version',
      async (req) => {
        const version = Number(req.params.version);
        const config = getVersionConfig(db, req.params.slug, version);
        if (!config) throw new HttpError(404, 'Version not found');
        return { version, config };
      },
    );
    admin.post('/api/admin/validate', async (req) => ({
      issues: validateConfig((req.body as { config?: unknown } | null)?.config).issues,
    }));
    admin.post<{ Params: { slug: string } }>('/api/admin/funnels/:slug/versions', async (req) => {
      const body = z.object({ config: z.unknown(), note: z.string().max(500).optional() }).parse(req.body);
      return publishVersion(db, req.params.slug, body.config, body.note ?? null);
    });
    admin.post<{ Params: { slug: string } }>('/api/admin/funnels/:slug/rollback', async (req) => {
      const body = z.object({ toVersion: z.number().int().positive().optional() }).parse(req.body ?? {});
      rollback(db, req.params.slug, body.toVersion);
      return funnelAdmin(db, req.params.slug);
    });
    admin.get('/api/admin/config-files', async () => ({
      files: configsDir && existsSync(configsDir) ? readdirSync(configsDir).filter((f) => f.endsWith('.json')).sort() : [],
    }));
    admin.get<{ Params: { name: string } }>('/api/admin/config-files/:name', async (req, reply) => {
      const { name } = req.params;
      if (!configsDir || !/^[\w.-]+\.json$/.test(name) || !existsSync(join(configsDir, name))) {
        throw new HttpError(404, 'Config file not found');
      }
      return reply.type('application/json').send(readFileSync(join(configsDir, name), 'utf8'));
    });
  });

  app.get('/api/analytics', async (req) => {
    const q = z
      .object({
        slug: z.string().default('workstyle-planner'),
        version: z.coerce.number().int().positive().optional(),
        variant: z.enum(['A', 'B']).optional(),
        utm_campaign: z.string().optional(),
      })
      .parse(req.query);
    return computeAnalytics(db, q.slug, { version: q.version, variant: q.variant, utm_campaign: q.utm_campaign });
  });

  if (webDir && existsSync(join(webDir, 'index.html'))) {
    app.register(fastifyStatic, { root: webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
