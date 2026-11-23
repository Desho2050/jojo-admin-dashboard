// Seeds the published dashboard's content API from ../../content-seed.json.
// Usage: node dev/seed.mjs <base-url> <admin-password>
// Example after publication: node dev/seed.mjs https://matbakhi-admin-49l01dixty4.qoder.website '<password>'
import { readFileSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
const password = process.argv[3];
if (!password) {
  console.error('usage: node dev/seed.mjs <base-url> <admin-password>');
  process.exit(1);
}

const seed = JSON.parse(readFileSync(new URL('../../content-seed.json', import.meta.url), 'utf8'));
const api = (path, init) => fetch(`${base}/functions/v1/app${path}`, init);

const loginResponse = await api('/api/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password })
});
if (!loginResponse.ok) {
  console.error('login failed', loginResponse.status, (await loginResponse.text()).slice(0, 200));
  process.exit(1);
}
const { token } = await loginResponse.json();

const documents = [
  ['recipes', { items: seed.recipes }],
  ['chef_posts', seed.chefPosts],
  ['meta', { featured: seed.meta.featured }]
];
for (const [key, value] of documents) {
  const response = await api('/api/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ key, value })
  });
  console.log(key, response.status, (await response.text()).slice(0, 120));
  if (!response.ok) process.exit(1);
}

const content = await (await api('/api/content')).json();
console.log(
  'verify: recipes', content.recipes.length,
  '| nadia', content.chefPosts.nadia.length,
  '| magda', content.chefPosts.magda.length,
  '| featured', content.meta.featured.length
);
