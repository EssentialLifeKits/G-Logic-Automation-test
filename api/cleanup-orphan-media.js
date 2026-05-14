const DEFAULT_BUCKET = 'media_uploads';
const DEFAULT_MAX_AGE_HOURS = 24;

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

function storagePathFromUrl(value, bucket) {
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
  return Number((bytes / 1024 / 1024).toFixed(2));
}

async function runCleanup({ apply }) {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;
  const maxAgeHours = Number(process.env.MEDIA_CLEANUP_MAX_AGE_HOURS || DEFAULT_MAX_AGE_HOURS);
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  const headers = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  };

  async function api(path, opts = {}) {
    const response = await fetch(`${supabaseUrl}${path}`, {
      ...opts,
      headers: { ...headers, ...(opts.headers || {}) },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${path}: ${text.slice(0, 500)}`);
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
          });
        } else if (row.name) {
          files.push(...await listBucketFiles(path));
        }
      }

      if (rows.length < 1000) break;
    }

    return files;
  }

  async function removeBatch(paths) {
    return api(`/storage/v1/object/${bucket}`, {
      method: 'DELETE',
      body: JSON.stringify({ prefixes: paths }),
    });
  }

  const files = await listBucketFiles();
  const posts = await api('/rest/v1/posts?select=*&limit=5000');
  const referencedPaths = new Set();

  for (const post of posts) {
    for (const value of Object.values(post)) {
      const path = storagePathFromUrl(value, bucket);
      if (path) referencedPaths.add(path);
    }
  }

  const candidates = files.filter(file => (
    !referencedPaths.has(file.path) && fileAgeHours(file) >= maxAgeHours
  ));

  let deleted = 0;
  if (apply) {
    for (let index = 0; index < candidates.length; index += 50) {
      const batch = candidates.slice(index, index + 50).map(file => file.path);
      await removeBatch(batch);
      deleted += batch.length;
    }
  }

  return {
    bucket,
    mode: apply ? 'apply' : 'dry-run',
    maxAgeHours,
    totalFiles: files.length,
    totalMb: mb(files.reduce((sum, file) => sum + file.size, 0)),
    referencedPaths: referencedPaths.size,
    candidates: candidates.length,
    candidateMb: mb(candidates.reduce((sum, file) => sum + file.size, 0)),
    deleted,
  };
}

module.exports = async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const isCronRequest = req.headers.authorization === `Bearer ${cronSecret}`;
  const isDryRun = req.query?.dryRun === '1';

  if (cronSecret && !isCronRequest) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  try {
    const result = await runCleanup({ apply: !isDryRun });
    return json(res, 200, result);
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
};
