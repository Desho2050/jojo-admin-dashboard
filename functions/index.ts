import { createDatabaseClient, createSiteContext, errorResponse, BackendError } from './_qoder/backend.mjs';
import { createStorageClient } from './_qoder/storage.mjs';
import { application } from './routes.mjs';

const handle = application({
  db: createDatabaseClient(),
  storage: createStorageClient(),
  BackendError,
  passwordSha256: Deno.env.get('ADMIN_PASSWORD_SHA256'),
  tokenSecret: Deno.env.get('TOKEN_SECRET')
});
Deno.serve(async request => {
  let context;
  try { context = createSiteContext(request); return await handle(context); }
  catch (error) { return errorResponse(error, context?.requestId); }
});
