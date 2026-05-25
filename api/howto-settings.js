const { getAuthUser, isAdminEmail, json } = require('../lib/paywall-utils');

const DEFAULT_BUCKET = 'media_uploads';
const SETTINGS_PATH = 'app_settings/howto-video.txt';

const DEFAULTS = {
  title: 'How To Use G-Logic',
  description: 'Watch this short walkthrough to get the most out of G-Logic Automation.',
  youtubeUrl: '',
  downloadUrl: '',
};

function envDefaults() {
  return {
    title: process.env.GLOGIC_HOWTO_TITLE || DEFAULTS.title,
    description: process.env.GLOGIC_HOWTO_DESCRIPTION || DEFAULTS.description,
    youtubeUrl: process.env.GLOGIC_HOWTO_YOUTUBE_URL || DEFAULTS.youtubeUrl,
    downloadUrl: process.env.GLOGIC_HOWTO_DRIVE_URL || DEFAULTS.downloadUrl,
  };
}

function cleanSettings(input = {}) {
  return {
    title: String(input.title || DEFAULTS.title).trim() || DEFAULTS.title,
    description: String(input.description || DEFAULTS.description).trim() || DEFAULTS.description,
    youtubeUrl: String(input.youtubeUrl || '').trim(),
    downloadUrl: String(input.downloadUrl || '').trim(),
    updatedAt: new Date().toISOString(),
  };
}

function getYouTubeVideoId(url) {
  if (!url) return null;
  return url.match(/youtu\.be\/([^?&#]+)/)?.[1]
    || url.match(/[?&]v=([^&#]+)/)?.[1]
    || url.match(/\/embed\/([^?&#]+)/)?.[1]
    || null;
}

function storageConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  return {
    bucket: process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
    },
    supabaseUrl,
  };
}

async function readStoredSettings() {
  const { bucket, headers, supabaseUrl } = storageConfig();
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${SETTINGS_PATH}`, {
    headers,
  });

  if (response.status === 404) return null;
  const text = await response.text();
  if (!response.ok && (text.includes('"not_found"') || text.includes('Object not found'))) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`${response.status} storage read failed: ${text.slice(0, 500)}`);
  }

  return text ? JSON.parse(text) : null;
}

async function writeStoredSettings(settings) {
  const { bucket, headers, supabaseUrl } = storageConfig();
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${SETTINGS_PATH}`, {
    method: 'POST',
    headers: {
      ...headers,
      'cache-control': '3600',
      'content-type': 'text/plain; charset=utf-8',
      'x-upsert': 'true',
    },
    body: JSON.stringify(settings),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} storage write failed: ${text.slice(0, 500)}`);
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const stored = await readStoredSettings();
      return json(res, 200, {
        settings: cleanSettings({ ...envDefaults(), ...(stored || {}) }),
        source: stored ? 'storage' : 'default',
      });
    }

    if (req.method === 'POST') {
      const user = await getAuthUser(req);
      if (!user || !isAdminEmail(user.email)) {
        return json(res, 403, { error: 'Admin access required.' });
      }

      const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
      const settings = cleanSettings(body);
      if (settings.youtubeUrl && !getYouTubeVideoId(settings.youtubeUrl)) {
        return json(res, 400, { error: 'Please enter a valid YouTube unlisted link.' });
      }

      await writeStoredSettings(settings);
      return json(res, 200, { settings, source: 'storage' });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
};
