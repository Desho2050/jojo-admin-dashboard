// Local fixtures only — kept in dev/ so they never enter the publication ZIP.
// Runs the real functions/routes.mjs against in-memory db/storage so the
// dashboard can be exercised without cloud credentials.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export class LocalError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } }

export function createMemoryRuntime() {
  const seed = JSON.parse(readFileSync(resolve(projectRoot, '..', 'content-seed.json'), 'utf8'));
  const now = () => new Date().toISOString();
  const tables = {
    content_documents: [
      { key: 'recipes', value: { items: seed.recipes }, updated_at: now() },
      { key: 'chef_posts', value: { nadia: seed.chefPosts.nadia, magda: seed.chefPosts.magda }, updated_at: now() },
      { key: 'meta', value: { featured: seed.meta.featured }, updated_at: now() },
    ],
  };
  const objects = new Map();

  const db = { from(table) {
    if (!(table in tables)) throw new LocalError('invalid_table', 400);
    const filters = [];
    let mode = 'read', values, count = 1000;
    const query = {
      select() { return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      order() { return query; },
      limit(value) { count = value; return query; },
      insert(value) { mode = 'insert'; values = value; return query; },
      update(value) { mode = 'update'; values = value; return query; },
      then(fulfilled, rejected) {
        return Promise.resolve().then(() => {
          let result;
          if (mode === 'insert') {
            if (tables[table].some(row => row.key === values.key)) throw new LocalError('duplicate_key', 409);
            tables[table].push({ ...values });
            result = [{ ...values }];
          } else {
            result = tables[table].filter(row => filters.every(([key, value]) => row[key] === value));
            if (mode === 'update') result.forEach(row => Object.assign(row, values));
          }
          return { data: result.slice(0, count).map(row => ({ ...row })), error: null };
        }).then(fulfilled, rejected);
      },
    };
    return query;
  } };

  const storage = {
    async upload(path, bytes, { contentType }) {
      if (objects.has(path)) throw new LocalError('object_exists', 409);
      objects.set(path, { bytes: new Uint8Array(bytes), type: contentType });
      return { Key: path };
    },
    async download(path) {
      const object = objects.get(path);
      if (!object) throw Object.assign(new Error('not found'), { code: 'storage_object_not_found' });
      return new Response(object.bytes, { headers: { 'content-type': object.type, 'content-length': String(object.bytes.length) } });
    },
    async createSignedUrl(path) {
      if (!objects.has(path)) throw new LocalError('storage_object_not_found', 404);
      return { signedUrl: `/storage/v1/object/sign/local/${path}?token=${randomUUID()}` };
    },
    async remove(paths) { for (const path of paths) objects.delete(path); return { ok: true }; },
  };

  return { db, storage, objects, tables };
}

export async function startLocalBackend(application, { port = 8000 } = {}) {
  const runtime = createMemoryRuntime();
  const secrets = JSON.parse(readFileSync(resolve(projectRoot, 'dev', 'secrets.json'), 'utf8'));
  const handle = application({ ...runtime, BackendError: LocalError,
    passwordSha256: secrets.adminPasswordSha256, tokenSecret: secrets.tokenSecret });
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, `http://${incoming.headers.host}`);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new LocalError('invalid_host', 403);
      if (!['GET', 'HEAD'].includes(incoming.method) && incoming.headers.origin && incoming.headers.origin !== url.origin) throw new LocalError('invalid_origin', 403);
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const request = new Request(url, {
        method: incoming.method, headers: incoming.headers,
        ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }),
      });
      let response;
      if (url.pathname.startsWith('/storage/v1/object/sign/local/')) {
        const path = decodeURIComponent(url.pathname.slice('/storage/v1/object/sign/local/'.length));
        response = await runtime.storage.download(path);
      } else {
        response = await handle({ request });
      }
      outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), 'cache-control': 'no-store' });
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.writeHead(error instanceof LocalError ? error.status : 500, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ error: error instanceof LocalError ? error.code : 'local_failure' }));
    }
  });
  await new Promise((fulfill, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', fulfill); });
  return { runtime, server, origin: `http://127.0.0.1:${port}`, close: () => new Promise((fulfill, reject) => server.close(error => error ? reject(error) : fulfill())) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { application } = await import(new URL('../functions/routes.mjs', import.meta.url).href);
  const backend = await startLocalBackend(application);
  console.log(`Matbakhi admin local API on ${backend.origin} (memory fixtures, seeded from content-seed.json)`);
  const stop = async () => { await backend.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
