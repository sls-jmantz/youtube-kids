const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const isDev = !app.isPackaged;
const settingsSchemaVersion = 3;

const defaultSettings = {
  schemaVersion: settingsSchemaVersion,
  approvedChannels: [],
  blockedChannels: [],
  categories: ['Learning', 'Music', 'Shows', 'Calm'],
  hiddenVideos: [],
  language: 'en',
  pinHash: '',
  pinSalt: '',
  region: 'US',
  youtubeApiKey: '',
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function feedCachePath(channelId) {
  return path.join(app.getPath('userData'), 'feed-cache', `${channelId}.xml`);
}

function logPath() {
  return path.join(app.getPath('userData'), 'app.log');
}

function backupDir() {
  return path.join(app.getPath('userData'), 'settings-backups');
}

async function appendLog(level, message, details = {}) {
  try {
    const entry = JSON.stringify({
      at: new Date().toISOString(),
      level,
      message,
      details,
    });
    await fs.mkdir(path.dirname(logPath()), { recursive: true });
    await fs.appendFile(logPath(), `${entry}\n`);
  } catch (_error) {
    // Logging must never break playback, imports, or discovery.
  }
}

async function readSettings() {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    const migrated = migrateSettings(JSON.parse(raw));
    if (migrated.needsWrite) await writeSettings(migrated.settings);
    return migrated.settings;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return defaultSettings;
  }
}

async function writeSettings(settings) {
  const nextSettings = migrateSettings(settings).settings;
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(nextSettings, null, 2));
  return nextSettings;
}

async function backupCurrentSettings(reason) {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.mkdir(backupDir(), { recursive: true });
    await fs.writeFile(path.join(backupDir(), `${stamp}-${reason}.json`), raw);
    const backups = await fs.readdir(backupDir());
    const jsonBackups = backups.filter((fileName) => fileName.endsWith('.json')).sort();
    await Promise.all(jsonBackups.slice(0, Math.max(0, jsonBackups.length - 20)).map((fileName) => (
      fs.unlink(path.join(backupDir(), fileName))
    )));
  } catch (error) {
    if (error.code !== 'ENOENT') await appendLog('warn', 'Settings backup failed', { reason, error: error.message });
  }
}

async function fetchChannelFeed(channelId) {
  const cachePath = feedCachePath(channelId);
  try {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
    if (!response.ok) throw new Error(`Feed request failed: ${response.status}`);
    const xmlText = await response.text();
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, xmlText);
    return { xmlText, fromCache: false };
  } catch (error) {
    try {
      await appendLog('warn', 'Using cached channel feed after refresh failure', { channelId, error: error.message });
      return { xmlText: await fs.readFile(cachePath, 'utf8'), fromCache: true, warning: error.message };
    } catch (_cacheError) {
      await appendLog('error', 'Channel feed refresh failed with no cache available', { channelId, error: error.message });
      throw error;
    }
  }
}

function normalizeApprovedChannel(channel) {
  const now = new Date().toISOString();
  const id = String(channel?.id || '').trim();
  const title = String(channel?.title || id).trim();
  return {
    id,
    title,
    thumbnail: channel?.thumbnail || '',
    language: channel?.language || 'en',
    category: channel?.category || 'Learning',
    notes: channel?.notes || '',
    enabled: channel?.enabled !== false,
    approvedAt: channel?.approvedAt || now,
    lastReviewedAt: channel?.lastReviewedAt || '',
  };
}

function migrateSettings(rawSettings = {}) {
  const settings = { ...defaultSettings, ...rawSettings };
  settings.schemaVersion = settingsSchemaVersion;
  settings.approvedChannels = Array.isArray(settings.approvedChannels)
    ? settings.approvedChannels.map(normalizeApprovedChannel).filter((channel) => channel.id)
    : [];
  settings.blockedChannels = Array.isArray(settings.blockedChannels)
    ? [...new Set(settings.blockedChannels.map((id) => String(id).trim()).filter(Boolean))]
    : [];
  settings.hiddenVideos = Array.isArray(settings.hiddenVideos)
    ? [...new Set(settings.hiddenVideos.map((id) => String(id).trim()).filter(Boolean))]
    : [];
  settings.categories = Array.isArray(settings.categories) && settings.categories.length > 0
    ? [...new Set(settings.categories.map((category) => String(category).trim()).filter(Boolean))]
    : defaultSettings.categories;
  return {
    settings,
    needsWrite: rawSettings.schemaVersion !== settingsSchemaVersion,
  };
}

function validateImportSettings(rawSettings) {
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) {
    throw new Error('Import file must be a JSON object.');
  }
  if (rawSettings.approvedChannels !== undefined && !Array.isArray(rawSettings.approvedChannels)) {
    throw new Error('Import file has invalid approvedChannels. Expected an array.');
  }
  if (rawSettings.blockedChannels !== undefined && !Array.isArray(rawSettings.blockedChannels)) {
    throw new Error('Import file has invalid blockedChannels. Expected an array.');
  }
  if (rawSettings.hiddenVideos !== undefined && !Array.isArray(rawSettings.hiddenVideos)) {
    throw new Error('Import file has invalid hiddenVideos. Expected an array.');
  }
  if (rawSettings.categories !== undefined && !Array.isArray(rawSettings.categories)) {
    throw new Error('Import file has invalid categories. Expected an array.');
  }
  if (Array.isArray(rawSettings.approvedChannels)) {
    const invalidChannel = rawSettings.approvedChannels.find((channel) => (
      !channel || typeof channel !== 'object' || typeof channel.id !== 'string' || !channel.id.trim().startsWith('UC')
    ));
    if (invalidChannel) throw new Error('Import file has an approved channel without a valid UC channel ID.');
  }
}

async function youtubeErrorMessage(response, fallback) {
  let reason = '';
  let message = '';
  try {
    const data = await response.clone().json();
    reason = data.error?.errors?.[0]?.reason || '';
    message = data.error?.message || '';
  } catch (_error) {
    // Some failures are not JSON responses.
  }
  if (response.status === 403 && /quota/i.test(`${reason} ${message}`)) {
    return 'YouTube API quota is exhausted. Try again tomorrow or use a different API key.';
  }
  if (response.status === 400 && /key|api/i.test(`${reason} ${message}`)) {
    return 'The YouTube API key appears invalid. Check the key in Parent Admin.';
  }
  if (response.status === 403) {
    return 'YouTube API access was denied. Check API key restrictions and YouTube Data API access.';
  }
  return `${fallback}: ${response.status}${message ? ` (${message})` : ''}`;
}

function exportableSettings(settings) {
  const { pinHash, pinSalt, youtubeApiKey, ...safeSettings } = settings;
  return {
    ...safeSettings,
    exportedAt: new Date().toISOString(),
  };
}

function isLikelySelectedLanguage(channel, language) {
  const selectedLanguage = language || 'en';
  const defaultLanguage = channel.snippet?.defaultLanguage || channel.brandingSettings?.channel?.defaultLanguage || '';
  if (defaultLanguage && !defaultLanguage.toLowerCase().startsWith(selectedLanguage.toLowerCase())) return false;
  if (selectedLanguage !== 'en') return true;

  const text = `${channel.snippet?.title || ''} ${channel.snippet?.description || ''}`.toLowerCase();
  const blockedEnglishDiscoveryTerms = [
    'español',
    'espanol',
    'português',
    'portugues',
    'deutsch',
    'français',
    'francais',
    'italiano',
    'hindi',
    'arabic',
    'русский',
    '中文',
    '日本語',
    '한국어',
  ];
  if (blockedEnglishDiscoveryTerms.some((term) => text.includes(term))) return false;

  const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length;
  return text.length === 0 || nonAscii / text.length < 0.15;
}

function hashPin(pin, salt) {
  return crypto.pbkdf2Sync(String(pin), salt, 120000, 32, 'sha256').toString('hex');
}

function isAllowedAppUrl(url) {
  if (isDev && url.startsWith('http://127.0.0.1:5173')) return true;
  return url.startsWith('file://');
}

function isAllowedFrameUrl(url) {
  return url.startsWith('https://www.youtube-nocookie.com/') || url.startsWith('https://www.youtube.com/embed/');
}

function parseFeedEntries(xmlText) {
  const entries = [...xmlText.matchAll(/<entry>[\s\S]*?<\/entry>/g)].map((match) => match[0]);
  return entries.map((entry) => {
    const textFor = (tagName) => entry.match(new RegExp(`<(?:[a-z]+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:[a-z]+:)?${tagName}>`))?.[1] || '';
    const thumbnail = entry.match(/<media:thumbnail[^>]*url="([^"]+)"/)?.[1] || '';
    return {
      id: textFor('videoId'),
      title: textFor('title').replace(/<!\[CDATA\[|\]\]>/g, '') || 'Untitled video',
      published: textFor('published'),
      thumbnail,
    };
  }).filter((video) => video.id);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 920,
    minHeight: 640,
    title: 'Approved Tube Kids',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://www.youtube.com/') || url.startsWith('https://www.youtube-nocookie.com/')) return { action: 'deny' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppUrl(url)) event.preventDefault();
  });

  win.webContents.on('will-frame-navigate', (event, details) => {
    if (details.isMainFrame && !isAllowedAppUrl(details.url)) event.preventDefault();
    if (!details.isMainFrame && !isAllowedFrameUrl(details.url)) event.preventDefault();
  });

  if (isDev) {
    win.loadURL('http://127.0.0.1:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('settings:read', readSettings);
  ipcMain.handle('settings:write', (_event, settings) => writeSettings(settings));

  ipcMain.handle('settings:backup', async (_event, reason = 'manual') => {
    await backupCurrentSettings(String(reason).replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'manual');
    return { ok: true };
  });

  ipcMain.handle('settings:export', async () => {
    const settings = await readSettings();
    const result = await dialog.showSaveDialog({
      title: 'Export Approved Tube Kids Settings',
      defaultPath: `approved-tube-kids-settings-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON Settings', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.writeFile(result.filePath, JSON.stringify(exportableSettings(settings), null, 2));
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('settings:import', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Approved Tube Kids Settings',
      properties: ['openFile'],
      filters: [{ name: 'JSON Settings', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const currentSettings = await readSettings();
    let importedRaw;
    try {
      importedRaw = JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'));
    } catch (_error) {
      throw new Error('Import file is not valid JSON.');
    }
    validateImportSettings(importedRaw);
    const imported = migrateSettings({
      ...currentSettings,
      ...importedRaw,
      pinHash: currentSettings.pinHash,
      pinSalt: currentSettings.pinSalt,
      youtubeApiKey: currentSettings.youtubeApiKey,
    }).settings;
    await backupCurrentSettings('before-import');
    const saved = await writeSettings(imported);
    return { canceled: false, settings: saved, filePath: result.filePaths[0] };
  });

  ipcMain.handle('log:read', async () => {
    try {
      const raw = await fs.readFile(logPath(), 'utf8');
      return raw.trim().split('\n').slice(-80).join('\n');
    } catch (error) {
      if (error.code === 'ENOENT') return '';
      throw error;
    }
  });

  ipcMain.handle('pin:set', async (_event, pin) => {
    const normalizedPin = String(pin || '').trim();
    if (!/^\d{4,8}$/.test(normalizedPin)) throw new Error('PIN must be 4 to 8 digits.');
    const settings = await readSettings();
    const pinSalt = crypto.randomBytes(16).toString('hex');
    return writeSettings({
      ...settings,
      pinSalt,
      pinHash: hashPin(normalizedPin, pinSalt),
    });
  });

  ipcMain.handle('pin:verify', async (_event, pin) => {
    const settings = await readSettings();
    if (!settings.pinHash || !settings.pinSalt) return true;
    return crypto.timingSafeEqual(
      Buffer.from(settings.pinHash, 'hex'),
      Buffer.from(hashPin(String(pin || '').trim(), settings.pinSalt), 'hex'),
    );
  });

  ipcMain.handle('youtube:feed', async (_event, channelId) => {
    return fetchChannelFeed(channelId);
  });

  ipcMain.handle('youtube:channelVideos', async (_event, channelId) => {
    const feed = await fetchChannelFeed(channelId);
    const videos = parseFeedEntries(feed.xmlText);
    return videos.slice(0, 10);
  });

  ipcMain.handle('youtube:resolveChannel', async (_event, { input, apiKey }) => {
    const trimmed = (input || '').trim();
    const channelId = trimmed.match(/(UC[a-zA-Z0-9_-]{20,})/)?.[1];
    if (channelId) return { id: channelId, title: channelId };
    if (!apiKey) return { needsApiKey: true };

    const handle = trimmed.match(/@([a-zA-Z0-9_.-]+)/)?.[0] || (trimmed.startsWith('@') ? trimmed : `@${trimmed}`);
    const handleParams = new URLSearchParams({
      part: 'snippet',
      forHandle: handle,
      key: apiKey,
    });
    const handleResponse = await fetch(`https://www.googleapis.com/youtube/v3/channels?${handleParams.toString()}`);
    if (handleResponse.ok) {
      const handleData = await handleResponse.json();
      const channel = handleData.items?.[0];
      if (channel?.id) return { id: channel.id, title: channel.snippet?.title || channel.id };
    }

    const searchParams = new URLSearchParams({
      part: 'snippet',
      q: trimmed.replace(/^@/, ''),
      type: 'channel',
      maxResults: '1',
      safeSearch: 'strict',
      key: apiKey,
    });
    const searchResponse = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams.toString()}`);
    if (!searchResponse.ok) {
      const message = await youtubeErrorMessage(searchResponse, 'Channel lookup failed');
      await appendLog('error', 'Channel lookup failed', { status: searchResponse.status, message });
      throw new Error(message);
    }
    const searchData = await searchResponse.json();
    const item = searchData.items?.[0];
    return item?.id?.channelId
      ? { id: item.id.channelId, title: item.snippet?.title || item.id.channelId }
      : { notFound: true };
  });

  ipcMain.handle('youtube:discover', async (_event, { query, language, region, apiKey }) => {
    if (!apiKey) return { needsApiKey: true, items: [] };
    const params = new URLSearchParams({
      part: 'snippet',
      q: query,
      type: 'channel',
      maxResults: '12',
      relevanceLanguage: language || 'en',
      regionCode: region || 'US',
      safeSearch: 'strict',
      key: apiKey,
    });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
    if (!response.ok) {
      const message = await youtubeErrorMessage(response, 'Discovery request failed');
      await appendLog('error', 'Discovery request failed', { status: response.status, query, message });
      throw new Error(message);
    }
    const data = await response.json();
    const channelIds = (data.items || []).map((item) => item.id.channelId).filter(Boolean);
    if (channelIds.length === 0) return { needsApiKey: false, items: [] };
    const detailParams = new URLSearchParams({
      part: 'snippet,brandingSettings',
      id: channelIds.join(','),
      key: apiKey,
    });
    const detailResponse = await fetch(`https://www.googleapis.com/youtube/v3/channels?${detailParams.toString()}`);
    if (!detailResponse.ok) {
      const message = await youtubeErrorMessage(detailResponse, 'Channel detail request failed');
      await appendLog('error', 'Channel detail request failed', { status: detailResponse.status, channelIds, message });
      throw new Error(message);
    }
    const detailData = await detailResponse.json();
    const detailsById = new Map((detailData.items || []).map((item) => [item.id, item]));

    return {
      needsApiKey: false,
      items: (data.items || []).map((item) => ({
        id: item.id.channelId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
        detail: detailsById.get(item.id.channelId),
      }))
        .filter((item) => item.id && item.detail && isLikelySelectedLanguage(item.detail, language))
        .map(({ detail, ...item }) => item),
    };
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
