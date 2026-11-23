// وصفات جوجو — Supabase Edge Function build of the admin API (slug: app).
// Same routes/validators as ../routes.mjs; data lives in schema `jojo`
// (table content_documents) and private bucket `jojo-chef-images`.
// Secrets (never committed): ADMIN_PASSWORD_SHA256 / TOKEN_SECRET.
import { createClient } from 'npm:@supabase/supabase-js@2';

const ADMIN_USER = 'admin';
const TOKEN_TTL_SECONDS = 12 * 3600;

const CATEGORIES = ['BREAKFAST', 'MAIN', 'SOUP', 'BREAD', 'DESSERT', 'DRINK'];
const KITCHENS = ['MASRI', 'SHAMI', 'KHALEEJI', 'MAGHRIBI'];
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];
const DOC_KEYS = ['recipes', 'chef_posts', 'meta'];
const ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const IMAGE_PATH_PATTERN = /^chef-images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;
const UPLOAD_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const textEncoder = new TextEncoder();

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function b64url(string: string) {
  return btoa(string).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function makeAuth(tokenSecret: string) {
  const keyPromise = crypto.subtle.importKey('raw', textEncoder.encode(tokenSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  async function issueToken() {
    const payload = b64url(JSON.stringify({ u: ADMIN_USER, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }));
    const sig = await crypto.subtle.sign('HMAC', await keyPromise, textEncoder.encode(payload));
    const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
    return { token: `${payload}.${hex}`, expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000 };
  }

  async function verifyToken(token: string) {
    const dot = typeof token === 'string' ? token.lastIndexOf('.') : -1;
    if (dot < 1 || dot === token.length - 1) return false;
    const payload = token.slice(0, dot), signature = token.slice(dot + 1);
    if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{64}$/.test(signature)) return false;
    const sig = await crypto.subtle.sign('HMAC', await keyPromise, textEncoder.encode(payload));
    const expected = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (!timingSafeEqualHex(signature, expected)) return false;
    try {
      const claim = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      return claim.u === ADMIN_USER && Number.isFinite(claim.exp) && claim.exp > Math.floor(Date.now() / 1000);
    } catch { return false; }
  }

  return { issueToken, verifyToken };
}

function isStr(value: unknown, max: number, { min = 0 }: { min?: number } = {}) {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}
function isInt(value: unknown, min: number, max: number) { return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max; }

function validRecipe(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  if (!ID_PATTERN.test(value.id ?? '') || !isStr(value.name, 120, { min: 1 }) || !isStr(value.subtitle ?? '', 200)) return false;
  if (!CATEGORIES.includes(value.category) || !KITCHENS.includes(value.kitchen) || !DIFFICULTIES.includes(value.difficulty)) return false;
  if (!isStr(value.emoji ?? '', 8, { min: 1 })) return false;
  if (!isInt(value.prepMinutes, 0, 600) || !isInt(value.cookMinutes, 0, 1440) || !isInt(value.servings, 1, 100)) return false;
  if (!isStr(value.description ?? '', 5000)) return false;
  if (!Array.isArray(value.ingredients) || value.ingredients.length > 100) return false;
  if (!value.ingredients.every((i: any) => i && isStr(i.name, 200, { min: 1 }) && isStr(i.amount ?? '', 100))) return false;
  if (!Array.isArray(value.steps) || value.steps.length > 100) return false;
  if (!value.steps.every((s: any) => s && isStr(s.text, 2000, { min: 1 }) && isInt(s.minutes ?? 0, 0, 600)
    && (s.tip == null || isStr(s.tip, 1000)))) return false;
  if (!Array.isArray(value.notes ?? []) || (value.notes ?? []).length > 20) return false;
  return (value.notes ?? []).every((n: any) => isStr(n, 2000));
}

function validChefPost(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value.id ?? '')) return false;
  if (!isStr(value.title, 200, { min: 1 })) return false;
  if (!isStr(value.assetPath ?? '', 200)) return false;
  if (!(value.imageUrl === '' || IMAGE_PATH_PATTERN.test(value.imageUrl ?? ''))) return false;
  if (!isStr(value.sourceUrl ?? '', 300)) return false;
  return !value.sourceUrl || value.sourceUrl.startsWith('https://');
}

function validDocument(key: string, value: any): boolean {
  if (key === 'recipes') {
    if (!Array.isArray(value?.items) || value.items.length > 500) return false;
    const ids = new Set();
    return value.items.every((r: any) => validRecipe(r) && !ids.has(r.id) && ids.add(r.id));
  }
  if (key === 'chef_posts') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return ['nadia', 'magda'].every(chef => Array.isArray(value[chef]) && value[chef].length <= 200
      && value[chef].every(validChefPost));
  }
  if (key === 'meta') {
    if (!Array.isArray(value?.featured) || value.featured.length > 50) return false;
    return value.featured.every((id: any) => ID_PATTERN.test(id));
  }
  return false;
}

class BackendError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

const passwordSha256 = Deno.env.get('ADMIN_PASSWORD_SHA256') ?? '';
const tokenSecret = Deno.env.get('TOKEN_SECRET') ?? '';
if (!/^[0-9a-f]{64}$/.test(passwordSha256)) throw new Error('passwordSha256 (64-char hex digest) is required');
if (typeof tokenSecret !== 'string' || tokenSecret.length < 32) throw new Error('tokenSecret (>= 32 chars) is required');

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } });
const db = supabase.schema('jojo');
const bucket = supabase.storage.from('jojo-chef-images');

const storage = {
  async createSignedUrl(path: string) {
    const { data, error } = await bucket.createSignedUrl(path, 3600);
    if (error) return { signedUrl: '' };
    return { signedUrl: data?.signedUrl ?? '' };
  },
  async upload(path: string, bytes: Uint8Array, opts: { contentType: string; upsert: boolean }) {
    const { error } = await bucket.upload(path, bytes as unknown as Blob, opts);
    if (error) throw new BackendError('storage_unavailable', 503);
  },
  download: async (path: string): Promise<Response> => {
    const { data, error } = await bucket.download(path);
    if (error || !data) throw new BackendError('storage_unavailable', 503);
    return new Response(data, { status: 200, headers: { 'content-type': data.type || 'application/octet-stream' } });
  },
  remove: (paths: string[]) => bucket.remove(paths),
};

const { issueToken, verifyToken } = makeAuth(tokenSecret);
function fail(code: string, status: number): never { throw new BackendError(code, status); }
const rows = (result: any) => {
  if (result?.error) fail(String(result.error.code ?? 'database_unavailable'), result.error.status ?? 503);
  return result?.data ?? [];
};

async function readJson(request: Request, maxBytes: number) {
  const type = request.headers.get('content-type');
  if (!type?.startsWith('application/json')) fail('invalid_input', 400);
  const reader = request.body?.getReader();
  if (!reader) fail('invalid_input', 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); fail('payload_too_large', 413); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BackendError) throw error;
    fail('invalid_input', 400);
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('invalid_input', 400); }
}

async function requireAdmin(request: Request) {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!(await verifyToken(token))) fail('login_required', 401);
}

async function loadDocuments() {
  const found = rows(await db.from('content_documents').select('key,value').limit(10));
  const docs: any = {};
  for (const row of found) docs[row.key] = row.value;
  return {
    recipes: Array.isArray(docs.recipes?.items) ? docs.recipes.items : [],
    chefPosts: docs.chef_posts && typeof docs.chef_posts === 'object'
      ? { nadia: Array.isArray(docs.chef_posts.nadia) ? docs.chef_posts.nadia : [], magda: Array.isArray(docs.chef_posts.magda) ? docs.chef_posts.magda : [] }
      : { nadia: [], magda: [] },
    meta: docs.meta && typeof docs.meta === 'object' ? docs.meta : { featured: [] },
  };
}

async function signContent(chefPosts: any) {
  const out: any = { nadia: [], magda: [] };
  for (const chef of ['nadia', 'magda']) {
    for (const post of chefPosts[chef]) {
      let signed = '';
      if (post.imageUrl) {
        try { signed = (await storage.createSignedUrl(post.imageUrl))?.signedUrl ?? ''; }
        catch { signed = ''; }
      }
      out[chef].push({ ...post, signedUrl: signed });
    }
  }
  return out;
}

async function handle(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const match = pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
  if (!match) fail('not_found', 404);
  const path = match[1] || '/';

  if (path === '/api/health' && request.method === 'GET') return Response.json({ ok: true });

  if (path === '/api/login' && request.method === 'POST') {
    const body = await readJson(request, 16 * 1024);
    const givenHash = typeof body?.password === 'string' ? await sha256Hex(body.password) : '';
    if (body?.username !== ADMIN_USER || !timingSafeEqualHex(givenHash, passwordSha256)) fail('invalid_credentials', 401);
    const { token, expiresAt } = await issueToken();
    return Response.json({ token, expiresAt });
  }

  if (path === '/api/content' && request.method === 'GET') {
    const docs = await loadDocuments();
    const chefPosts = await signContent(docs.chefPosts);
    return Response.json({ ok: true, version: 1, fetchedAt: new Date().toISOString(), ...docs, chefPosts });
  }

  if (path === '/api/documents' && request.method === 'POST') {
    await requireAdmin(request);
    const body = await readJson(request, MAX_BODY_BYTES);
    const { key, value } = body ?? {};
    if (!DOC_KEYS.includes(key) || !validDocument(key, value)) fail('invalid_input', 400);
    const updatedAt = new Date().toISOString();
    const updated = rows(await db.from('content_documents')
      .update({ value, updated_at: updatedAt }).eq('key', key).select('key'));
    if (!updated?.length) {
      rows(await db.from('content_documents').insert({ key, value, updated_at: updatedAt }));
    }
    return Response.json({ ok: true, key, updatedAt });
  }

  if (path === '/api/upload' && request.method === 'POST') {
    await requireAdmin(request);
    const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = UPLOAD_TYPES[type];
    if (!ext) fail('invalid_upload', 422);
    const reader = request.body?.getReader();
    if (!reader) fail('invalid_input', 400);
    let size = 0, timedOut = false;
    const chunks: Uint8Array[] = [];
    const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 30000);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (timedOut) fail('storage_unavailable', 503);
        if (done) break;
        size += value!.byteLength;
        if (size > MAX_UPLOAD_BYTES) fail('invalid_upload', 422);
        chunks.push(value!);
      }
    } catch (error) {
      if (error instanceof BackendError) throw error;
      fail('invalid_input', 400);
    } finally { clearTimeout(timer); reader.releaseLock(); }
    if (size < 100) fail('invalid_upload', 422);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const objectPath = `chef-images/${crypto.randomUUID()}.${ext}`;
    await storage.upload(objectPath, bytes, { contentType: type, upsert: false });
    // Do not trust the write to have landed as sent: verify the stored object.
    let stored: Response;
    try { stored = await storage.download(objectPath); } catch { fail('storage_unavailable', 503); }
    const storedType = stored.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    const storedBytes = new Uint8Array(await stored.arrayBuffer());
    if (!stored.ok || storedType !== type || storedBytes.byteLength !== size) {
      try { await storage.remove([objectPath]); } catch { /* cleanup is best effort */ }
      fail('invalid_upload', 422);
    }
    return Response.json({ ok: true, path: objectPath });
  }

  fail('not_found', 404);
}

const CORS_HEADERS = new Headers();
CORS_HEADERS.set('access-control-allow-methods', 'GET, POST, OPTIONS');
CORS_HEADERS.set('access-control-allow-headers', 'content-type, authorization');
CORS_HEADERS.set('access-control-max-age', '600');

function corsHeadersFor(request: Request) {
  const origin = request.headers.get('origin');
  const headers = new Headers(CORS_HEADERS);
  headers.set('access-control-allow-origin', origin ?? '*');
  headers.set('vary', 'origin');
  return headers;
}

function withCors(response: Response, request: Request) {
  const headers = corsHeadersFor(request);
  response.headers.forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeadersFor(request) });
  try { return withCors(await handle(request), request); }
  catch (error) {
    if (error instanceof BackendError) {
      return withCors(Response.json({ ok: false, error: error.code }, { status: error.status }), request);
    }
    return withCors(Response.json({ ok: false, error: 'internal_error' }, { status: 500 }), request);
  }
});
