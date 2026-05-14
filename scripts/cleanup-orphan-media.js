#!/usr/bin/env node

const DEFAULT_BUCKET = 'media_uploads';
const DEFAULT_MAX_AGE_HOURS = 24;

const args = new Map(
  process.argv.slice(2).map(arg => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.length ? rest.join('=') : true];
  })
);

const apply = args.has('apply');
const bucket = String(args.get('bucket') || process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET);
const maxAgeHours = Number(args.get('max-age-hours') || process.env.MEDIA_CLEANUP_MAX_AGE_HOURS || DEFAULT_MAX_AGE_HOURS);
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

if (!Number.isFinite(maxAgeHours) || maxAgeHours < 1) {
  console.error('max-age-hours must be a number greater than or equal to 1.');
  process.exit(1);
}

const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  'content-type': 'application/json',
};

async function api(path, opts = {}) {
  const res = await fetch(`${supabaseUrl}${path}`, {
    ...opts,
    headers: { ...headers, ...(opts.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${path}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function listBucketFiles(prefix = '') {
  const files = [];

  for (let offset = 0; ; offset += 1000) {
    const rows = await api(`/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      body: JSON.stringify({
        prefix,
        limit: 1000,
        offset,
        sortBy: { column: 'updated_at', order: 'desc' },
      }),
    });

    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      const path = prefix ? `${prefix}/${row.name}` : row.name;
      if (row.metadata && typeof row.metadata.size === 'number') {
        files.push({
          path,
          size: row.metadata.size,
          updatedAt: row.updated_at || row.created_at || '',
          mimetype: row.metadata.mimetype || '',
        });
      } else if (row.name) {
        files.push(...await listBucketFiles(path));
      }
    }

    if (rows.length < 1000) break;
  }

  return files;
}

function storagePathFromUrl(value) {
  if (!value || typeof value !== 'string') return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const index = value.indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(value.slice(index + marker.length).split('?')[0]);
}

function fileAgeHours(file) {
  const timestamp = Date.parse(file.updatedAt);
  if (!Number.isFinite(timestamp)) return Infinity;
  return (Date.now() - timestamp) / 36e5;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function removeBatch(paths) {
  return api(`/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    body: JSON.stringify({ prefixes: paths }),
  });
}

async function main() {
  const files = await listBucketFiles();
  const posts = await api('/rest/v1/posts?select=*&limit=5000');
  const referencedPaths = new Set();

  for (const post of posts) {
    for (const value of Object.values(post)) {
      const path = storagePathFromUrl(value);
      if (path) referencedPaths.add(path);
    }
  }

  const candidates = files.filter(file => (
    !referencedPaths.has(file.path) && fileAgeHours(file) >= maxAgeHours
  ));

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const candidateBytes = candidates.reduce((sum, file) => sum + file.size, 0);

  console.log(`Bucket: ${bucket}`);
  console.log(`Mode: ${apply ? 'apply' : 'dry-run'}`);
  console.log(`Grace period: ${maxAgeHours} hours`);
  console.log(`Total storage: ${files.length} files, ${mb(totalBytes)}`);
  console.log(`Referenced by posts: ${referencedPaths.size} paths`);
  console.log(`Cleanup candidates: ${candidates.length} files, ${mb(candidateBytes)}`);

  candidates
    .sort((a, b) => b.size - a.size)
    .slice(0, 20)
    .forEach(file => {
      console.log(`- ${mb(file.size)} | ${file.updatedAt || 'no date'} | ${file.path}`);
    });

  if (!apply || candidates.length === 0) return;

  for (let index = 0; index < candidates.length; index += 50) {
    const batch = candidates.slice(index, index + 50).map(file => file.path);
    await removeBatch(batch);
    console.log(`Deleted batch ${Math.floor(index / 50) + 1}: ${batch.length} files`);
  }

  const remaining = await listBucketFiles();
  const remainingBytes = remaining.reduce((sum, file) => sum + file.size, 0);
  console.log(`After cleanup: ${remaining.length} files, ${mb(remainingBytes)}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
