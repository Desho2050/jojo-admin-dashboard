// Throwaway smoke test for the local admin API (dev only).
import { readFileSync } from 'node:fs';
const PASSWORD = JSON.parse(readFileSync(new URL('./secrets.json', import.meta.url), 'utf8')).adminPassword;
const BASE = 'http://127.0.0.1:8000/functions/v1/app';
const j = (r, init) => fetch(r, init).then(async x => ({ status: x.status, body: await x.json().catch(() => null) }));
const assert = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + label); if (!cond) process.exitCode = 1; };

let r = await j(`${BASE}/api/health`);
assert(r.status === 200 && r.body.ok === true, 'health');

r = await j(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'wrong' }) });
assert(r.status === 401 && r.body.error === 'invalid_credentials', 'login rejects wrong password');

r = await j(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PASSWORD }) });
assert(r.status === 200 && typeof r.body.token === 'string' && r.body.token.includes('.'), 'login issues token');
const token = r.body.token;

r = await j(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: `${PASSWORD} ` }) });
assert(r.status === 401, 'login is exact (no trim)');

const auth = { authorization: `Bearer ${token}` };
r = await j(`${BASE}/api/content`);
assert(r.status === 200 && r.body.recipes.length === 38 && r.body.chefPosts.nadia.length === 10 && r.body.chefPosts.magda.length === 0 && r.body.meta.featured.length === 6, 'public content shape');
assert(r.body.recipes.every(recipe => recipe.signedImageUrl === ''), 'legacy recipes keep emoji fallback');

const seedRecipes = r.body.recipes.map(({ signedImageUrl: _signed, ...recipe }) => recipe);
r = await j(`${BASE}/api/documents`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ key: 'recipes', value: { items: seedRecipes.map(recipe => recipe.id === 'koshari' ? { ...recipe, imageUrl: 'https://example.com/image.png' } : recipe) } }) });
assert(r.status === 400, 'recipe image rejects external URL');

r = await j(`${BASE}/api/documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'meta', value: { featured: ['koshari'] } }) });
assert(r.status === 401, 'save requires token');

r = await j(`${BASE}/api/documents`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ key: 'meta', value: { featured: ['not an id'] } }) });
assert(r.status === 400, 'save rejects invalid ids');

r = await j(`${BASE}/api/documents`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ key: 'recipes', value: { items: [{ id: 'koshari', name: 'x'.repeat(121) }] } }) });
assert(r.status === 400, 'save rejects invalid recipe');

r = await j(`${BASE}/api/documents`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ key: 'meta', value: { featured: ['koshari', 'kunafa'] } }) });
assert(r.status === 200 && r.body.ok, 'save meta');

r = await j(`${BASE}/api/content`);
assert(r.body.meta.featured.length === 2, 'content reflects saved meta');

// forged token (payload only re-signed with wrong key) must fail
const forged = token.split('.')[0] + '.' + '0'.repeat(64);
r = await j(`${BASE}/api/documents`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${forged}` }, body: JSON.stringify({ key: 'meta', value: { featured: [] } }) });
assert(r.status === 401, 'forged token rejected');

// upload: fake webp bytes >100
const bytes = new Uint8Array(512); bytes.set([0x52, 0x49, 0x46, 0x46], 0);
r = await j(`${BASE}/api/upload`, { method: 'POST', headers: { 'content-type': 'image/webp', ...auth }, body: bytes });
assert(r.status === 200 && /^chef-images\/[0-9a-f-]+\.webp$/.test(r.body.path), 'upload returns path');
const uploadedPath = r.body.path;

r = await j(`${BASE}/api/upload`, { method: 'POST', headers: { 'content-type': 'image/svg+xml', ...auth }, body: bytes });
assert(r.status === 422, 'upload rejects svg');

r = await j(`${BASE}/api/upload`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: bytes });
assert(r.status === 401, 'upload requires token');

// attach the uploaded image to a new chef post, then content should carry a signed URL
r = await j(`${BASE}/api/content`);
const chefPosts = r.body.chefPosts;
chefPosts.nadia.push({ id: 'test-post-1', title: 'منشور تجريبي', assetPath: '', imageUrl: uploadedPath, sourceUrl: 'https://www.facebook.com/reel/1' });
r = await j(`${BASE}/api/documents`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ key: 'chef_posts', value: chefPosts }) });
assert(r.status === 200, 'save chef posts with uploaded image');

r = await j(`${BASE}/api/content`);
const tp = r.body.chefPosts.nadia.find(p => p.id === 'test-post-1');
assert(tp && tp.signedUrl.startsWith('/storage/v1/'), 'content signs uploaded image');
const img = await fetch('http://127.0.0.1:8000' + tp.signedUrl);
assert(img.status === 200 && img.headers.get('content-type') === 'image/webp', 'signed url serves bytes');

// recipe image: attach the uploaded object, sign it on read, and never persist the signature
r = await j(`${BASE}/api/content`);
const recipes = r.body.recipes.map(({ signedImageUrl: _signed, ...recipe }) =>
  recipe.id === 'koshari' ? { ...recipe, imageUrl: uploadedPath } : recipe);
r = await j(`${BASE}/api/documents`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ key: 'recipes', value: { items: recipes } }) });
assert(r.status === 200 && r.body.ok, 'save recipe image path');

r = await j(`${BASE}/api/content`);
const recipeImage = r.body.recipes.find(recipe => recipe.id === 'koshari');
assert(recipeImage.imageUrl === uploadedPath && recipeImage.signedImageUrl.startsWith('/storage/v1/'), 'content signs recipe image');
const recipeImg = await fetch('http://127.0.0.1:8000' + recipeImage.signedImageUrl);
assert(recipeImg.status === 200 && recipeImg.headers.get('content-type') === 'image/webp', 'recipe signed url serves bytes');

r = await j(`${BASE}/api/documents`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ key: 'recipes', value: { items: r.body.recipes } }) });
assert(r.status === 400, 'save rejects transient recipe image signatures');

r = await j(`${BASE}/api/documents`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ key: 'recipes', value: { items: recipes.map(recipe => recipe.id === 'koshari' ? { ...recipe, imageUrl: '' } : recipe) } }) });
assert(r.status === 200, 'remove recipe image');
r = await j(`${BASE}/api/content`);
assert(r.body.recipes.find(recipe => recipe.id === 'koshari').signedImageUrl === '', 'removed recipe image returns empty signature');

r = await j(`${BASE}/api/unknown`);
assert(r.status === 404, 'unknown path 404');

console.log(process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED');
