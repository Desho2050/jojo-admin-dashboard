// وصفات جوجو — Admin API for app content. Business auth: HMAC stateless bearer
// token issued by /api/login and verified here. The password is stored only as
// a SHA-256 digest and the token secret is provided by the runtime environment
// (never committed): ADMIN_PASSWORD_SHA256 / TOKEN_SECRET.
const ADMIN_USER = 'admin';
const TOKEN_TTL_SECONDS = 12 * 3600;

const CATEGORIES = ['BREAKFAST', 'MAIN', 'SOUP', 'BREAD', 'DESSERT', 'DRINK'];
const KITCHENS = ['MASRI', 'SHAMI', 'KHALEEJI', 'MAGHRIBI'];
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];
const DOC_KEYS = ['recipes', 'chef_posts', 'meta'];
const ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const IMAGE_PATH_PATTERN = /^chef-images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;
const UPLOAD_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const textEncoder = new TextEncoder();

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function b64url(string) {
  return btoa(string).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function makeAuth(tokenSecret) {
  const keyPromise = crypto.subtle.importKey('raw', textEncoder.encode(tokenSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  async function issueToken() {
    const payload = b64url(JSON.stringify({ u: ADMIN_USER, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }));
    const sig = await crypto.subtle.sign('HMAC', await keyPromise, textEncoder.encode(payload));
    const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
    return { token: `${payload}.${hex}`, expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000 };
  }

  async function verifyToken(token) {
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

function isStr(value, max, { min = 0 } = {}) {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}
function isInt(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }

function validRecipe(value) {
  if (!value || typeof value !== 'object') return false;
  if (!ID_PATTERN.test(value.id ?? '') || !isStr(value.name, 120, { min: 1 }) || !isStr(value.subtitle ?? '', 200)) return false;
  if (!CATEGORIES.includes(value.category) || !KITCHENS.includes(value.kitchen) || !DIFFICULTIES.includes(value.difficulty)) return false;
  if (!isStr(value.emoji ?? '', 8, { min: 1 })) return false;
  if (!(value.imageUrl == null || value.imageUrl === '' || IMAGE_PATH_PATTERN.test(value.imageUrl))) return false;
  if ('signedImageUrl' in value) return false;
  if (!isInt(value.prepMinutes, 0, 600) || !isInt(value.cookMinutes, 0, 1440) || !isInt(value.servings, 1, 100)) return false;
  if (!isStr(value.description ?? '', 5000)) return false;
  if (!Array.isArray(value.ingredients) || value.ingredients.length > 100) return false;
  if (!value.ingredients.every(i => i && isStr(i.name, 200, { min: 1 }) && isStr(i.amount ?? '', 100))) return false;
  if (!Array.isArray(value.steps) || value.steps.length > 100) return false;
  if (!value.steps.every(s => s && isStr(s.text, 2000, { min: 1 }) && isInt(s.minutes ?? 0, 0, 600)
    && (s.tip == null || isStr(s.tip, 1000)))) return false;
  if (!Array.isArray(value.notes ?? []) || (value.notes ?? []).length > 20) return false;
  return (value.notes ?? []).every(n => isStr(n, 2000));
}

function validChefPost(value) {
  if (!value || typeof value !== 'object') return false;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value.id ?? '')) return false;
  if (!isStr(value.title, 200, { min: 1 })) return false;
  if (!isStr(value.assetPath ?? '', 200)) return false;
  if (!(value.imageUrl === '' || IMAGE_PATH_PATTERN.test(value.imageUrl ?? ''))) return false;
  if (!isStr(value.sourceUrl ?? '', 300)) return false;
  return !value.sourceUrl || value.sourceUrl.startsWith('https://');
}

function validDocument(key, value) {
  if (key === 'recipes') {
    if (!Array.isArray(value?.items) || value.items.length > 500) return false;
    const ids = new Set();
    return value.items.every(r => validRecipe(r) && !ids.has(r.id) && ids.add(r.id));
  }
  if (key === 'chef_posts') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return ['nadia', 'magda'].every(chef => Array.isArray(value[chef]) && value[chef].length <= 200
      && value[chef].every(validChefPost));
  }
  if (key === 'meta') {
    if (!Array.isArray(value?.featured) || value.featured.length > 50) return false;
    return value.featured.every(id => ID_PATTERN.test(id));
  }
  return false;
}

export function application({ db, storage, BackendError, passwordSha256, tokenSecret }) {
  if (!/^[0-9a-f]{64}$/.test(passwordSha256 ?? '')) throw new Error('passwordSha256 (64-char hex digest) is required');
  if (typeof tokenSecret !== 'string' || tokenSecret.length < 32) throw new Error('tokenSecret (>= 32 chars) is required');
  const { issueToken, verifyToken } = makeAuth(tokenSecret);
  const fail = (code, status) => { throw new BackendError(code, status); };
  const rows = result => { if (result?.error) fail(result.error.code ?? 'database_unavailable', result.error.status ?? 503); return result?.data ?? []; };

  async function readJson(request, maxBytes) {
    const type = request.headers.get('content-type');
    if (!type?.startsWith('application/json')) fail('invalid_input', 400);
    const reader = request.body?.getReader();
    if (!reader) fail('invalid_input', 400);
    let size = 0;
    const chunks = [];
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

  async function requireAdmin(request) {
    const header = request.headers.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!(await verifyToken(token))) fail('login_required', 401);
  }

  async function loadDocuments() {
    const found = rows(await db.from('content_documents').select('key,value').limit(10));
    const docs = {};
    for (const row of found) docs[row.key] = row.value;
    return {
      recipes: Array.isArray(docs.recipes?.items) ? docs.recipes.items : [],
      chefPosts: docs.chef_posts && typeof docs.chef_posts === 'object'
        ? { nadia: Array.isArray(docs.chef_posts.nadia) ? docs.chef_posts.nadia : [], magda: Array.isArray(docs.chef_posts.magda) ? docs.chef_posts.magda : [] }
        : { nadia: [], magda: [] },
      meta: docs.meta && typeof docs.meta === 'object' ? docs.meta : { featured: [] },
    };
  }

  async function signContent(recipes, chefPosts) {
    const signedRecipes = [];
    for (const recipe of recipes) {
      let signed = '';
      if (recipe.imageUrl) {
        try { signed = (await storage.createSignedUrl(recipe.imageUrl, 3600))?.signedUrl ?? ''; }
        catch { signed = ''; }
      }
      signedRecipes.push({ ...recipe, signedImageUrl: signed });
    }
    const out = { nadia: [], magda: [] };
    for (const chef of ['nadia', 'magda']) {
      for (const post of chefPosts[chef]) {
        let signed = '';
        if (post.imageUrl) {
          try { signed = (await storage.createSignedUrl(post.imageUrl, 3600))?.signedUrl ?? ''; }
          catch { signed = ''; }
        }
        out[chef].push({ ...post, signedUrl: signed });
      }
    }
    return { recipes: signedRecipes, chefPosts: out };
  }

  return async ctx => {
    const request = ctx.request;
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
      const signed = await signContent(docs.recipes, docs.chefPosts);
      return Response.json({ ok: true, version: 1, fetchedAt: new Date().toISOString(), ...docs, ...signed });
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
      const chunks = [];
      const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 30000);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (timedOut) fail('storage_unavailable', 503);
          if (done) break;
          size += value.byteLength;
          if (size > MAX_UPLOAD_BYTES) fail('invalid_upload', 422);
          chunks.push(value);
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
      let stored;
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
  };
}
