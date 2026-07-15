const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const isDev = !app?.isPackaged && !process.argv.includes('--load-dist');
const settingsSchemaVersion = 7;
const channelIdPattern = /^UC[a-zA-Z0-9_-]{22}$/;
const videoIdPattern = /^[a-zA-Z0-9_-]{11}$/;
let settingsWriteQueue = Promise.resolve();

const defaultSettings = {
  schemaVersion: settingsSchemaVersion,
  approvedChannels: [],
  approvedVideoDetails: {},
  approvedVideos: [],
  blockedChannels: [],
  categories: ['Learning', 'Music', 'Shows', 'Calm'],
  favoriteVideoDetails: {},
  favoriteVideos: [],
  hiddenVideoDetails: {},
  hiddenVideos: [],
  language: 'en',
  pinHash: '',
  pinSalt: '',
  recentlyWatched: [],
  region: 'US',
  usageByDate: {},
  viewingLimits: {
    enabled: false,
    dailyMinutes: 60,
    quietHoursEnabled: false,
    quietStart: '20:00',
    quietEnd: '07:00',
  },
  youtubeApiKey: '',
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function feedCachePath(channelId) {
  if (!channelIdPattern.test(channelId)) throw new Error('Invalid YouTube channel ID.');
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
  const operation = settingsWriteQueue.then(async () => {
    const nextSettings = migrateSettings(settings).settings;
    const filePath = settingsPath();
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(nextSettings, null, 2));
      await fs.rename(temporaryPath, filePath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
    return nextSettings;
  });
  settingsWriteQueue = operation.catch(() => {});
  return operation;
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
    if (error.code === 'ENOENT') return false;
    await appendLog('warn', 'Settings backup failed', { reason, error: error.message });
    throw new Error(`Settings backup failed: ${error.message}`);
  }
  return true;
}

async function listSettingBackups() {
  try {
    const backups = await fs.readdir(backupDir());
    return (await Promise.all(backups.filter((fileName) => fileName.endsWith('.json')).map(async (fileName) => {
      const filePath = path.join(backupDir(), fileName);
      const stat = await fs.stat(filePath);
      return {
        fileName,
        createdAt: stat.mtime.toISOString(),
        size: stat.size,
      };
    }))).sort((a, b) => b.fileName.localeCompare(a.fileName));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function restoreSettingsBackup(fileName) {
  const backups = await listSettingBackups();
  if (!backups.some((backup) => backup.fileName === fileName)) throw new Error('Backup snapshot not found.');
  const filePath = path.join(backupDir(), fileName);
  const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
  validateImportSettings(raw);
  const currentSettings = await readSettings();
  const restored = migrateSettings({
    ...currentSettings,
    ...raw,
    pinHash: currentSettings.pinHash,
    pinSalt: currentSettings.pinSalt,
    youtubeApiKey: currentSettings.youtubeApiKey,
  }).settings;
  await backupCurrentSettings('before-restore-backup');
  return writeSettings(restored);
}

async function fetchChannelFeed(channelId) {
  if (!channelIdPattern.test(String(channelId || ''))) throw new Error('Invalid YouTube channel ID.');
  const cachePath = feedCachePath(channelId);
  try {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, {
      signal: AbortSignal.timeout(15000),
    });
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
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) rawSettings = {};
  if (Number(rawSettings.schemaVersion) > settingsSchemaVersion) {
    throw new Error(`Settings schema ${rawSettings.schemaVersion} is newer than this app supports.`);
  }
  const settings = { ...defaultSettings, ...rawSettings };
  settings.schemaVersion = settingsSchemaVersion;
  settings.approvedChannels = Array.isArray(settings.approvedChannels)
    ? settings.approvedChannels.map(normalizeApprovedChannel).filter((channel) => channelIdPattern.test(channel.id))
    : [];
  settings.approvedVideos = Array.isArray(settings.approvedVideos)
    ? [...new Set(settings.approvedVideos.map((id) => String(id).trim()).filter((id) => videoIdPattern.test(id)))]
    : [];
  settings.blockedChannels = Array.isArray(settings.blockedChannels)
    ? [...new Set(settings.blockedChannels.map((id) => String(id).trim()).filter((id) => channelIdPattern.test(id)))]
    : [];
  settings.hiddenVideos = Array.isArray(settings.hiddenVideos)
    ? [...new Set(settings.hiddenVideos.map((id) => String(id).trim()).filter((id) => videoIdPattern.test(id)))]
    : [];
  settings.favoriteVideos = Array.isArray(settings.favoriteVideos)
    ? [...new Set(settings.favoriteVideos.map((id) => String(id).trim()).filter((id) => videoIdPattern.test(id)))]
    : [];
  settings.recentlyWatched = Array.isArray(settings.recentlyWatched)
    ? settings.recentlyWatched.filter((video) => video && typeof video === 'object' && videoIdPattern.test(String(video.id || ''))).slice(0, 50)
    : [];
  settings.usageByDate = settings.usageByDate && typeof settings.usageByDate === 'object' && !Array.isArray(settings.usageByDate)
    ? Object.fromEntries(Object.entries(settings.usageByDate).map(([date, minutes]) => [date, Math.max(0, Number(minutes) || 0)]))
    : {};
  settings.viewingLimits = normalizeViewingLimits(settings.viewingLimits);
  settings.hiddenVideoDetails = settings.hiddenVideoDetails && typeof settings.hiddenVideoDetails === 'object' && !Array.isArray(settings.hiddenVideoDetails)
    ? settings.hiddenVideoDetails
    : {};
  settings.favoriteVideoDetails = settings.favoriteVideoDetails && typeof settings.favoriteVideoDetails === 'object' && !Array.isArray(settings.favoriteVideoDetails)
    ? settings.favoriteVideoDetails
    : {};
  settings.approvedVideoDetails = settings.approvedVideoDetails && typeof settings.approvedVideoDetails === 'object' && !Array.isArray(settings.approvedVideoDetails)
    ? settings.approvedVideoDetails
    : {};
  settings.hiddenVideoDetails = Object.fromEntries(Object.entries(settings.hiddenVideoDetails).filter(([videoId, video]) => (
    settings.hiddenVideos.includes(videoId) && video && typeof video === 'object'
  )).map(([videoId, video]) => [videoId, {
    id: videoId,
    title: String(video.title || videoId),
    channelTitle: String(video.channelTitle || 'Unknown channel'),
    channelId: String(video.channelId || ''),
    thumbnail: String(video.thumbnail || ''),
    hiddenAt: String(video.hiddenAt || ''),
  }]));
  settings.categories = Array.isArray(settings.categories) && settings.categories.length > 0
    ? [...new Set(settings.categories.map((category) => String(category).trim()).filter(Boolean))]
    : defaultSettings.categories;
  settings.language = typeof settings.language === 'string' && settings.language.trim() ? settings.language.trim() : 'en';
  settings.region = typeof settings.region === 'string' && settings.region.trim() ? settings.region.trim() : 'US';
  settings.youtubeApiKey = typeof settings.youtubeApiKey === 'string' ? settings.youtubeApiKey : '';
  settings.pinHash = typeof settings.pinHash === 'string' && /^[a-f0-9]{64}$/i.test(settings.pinHash) ? settings.pinHash : '';
  settings.pinSalt = settings.pinHash && typeof settings.pinSalt === 'string' && /^[a-f0-9]{32}$/i.test(settings.pinSalt) ? settings.pinSalt : '';
  if (!settings.pinSalt) settings.pinHash = '';
  const fallbackCategory = settings.categories[0];
  settings.approvedChannels = settings.approvedChannels.map((channel) => ({
    ...channel,
    category: settings.categories.includes(channel.category) ? channel.category : fallbackCategory,
  }));
  settings.approvedVideoDetails = normalizeVideoDetails(settings.approvedVideos, settings.approvedVideoDetails, 'approvedAt');
  settings.approvedVideoDetails = Object.fromEntries(Object.entries(settings.approvedVideoDetails).map(([videoId, video]) => [videoId, {
    ...video,
    category: settings.categories.includes(video.category) ? video.category : fallbackCategory,
  }]));
  settings.favoriteVideoDetails = normalizeVideoDetails(settings.favoriteVideos, settings.favoriteVideoDetails, 'favoritedAt');
  settings.recentlyWatched = settings.recentlyWatched.map((video) => normalizeVideoDetail(video.id, video, 'watchedAt'));
  return {
    settings,
    needsWrite: JSON.stringify(rawSettings) !== JSON.stringify(settings),
  };
}

function normalizeVideoDetail(videoId, video, dateField) {
  return {
    id: videoId,
    title: String(video.title || videoId),
    channelTitle: String(video.channelTitle || 'Unknown channel'),
    channelId: String(video.channelId || ''),
    thumbnail: String(video.thumbnail || ''),
    category: String(video.category || 'Learning'),
    [dateField]: String(video[dateField] || ''),
  };
}

function normalizeVideoDetails(videoIds, details, dateField) {
  return Object.fromEntries(Object.entries(details).filter(([videoId, video]) => (
    videoIds.includes(videoId) && video && typeof video === 'object'
  )).map(([videoId, video]) => [videoId, normalizeVideoDetail(videoId, video, dateField)]));
}

function normalizeViewingLimits(limits = {}) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) limits = {};
  const dailyMinutes = Math.max(1, Math.min(720, Number(limits.dailyMinutes) || defaultSettings.viewingLimits.dailyMinutes));
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return {
    enabled: limits.enabled === true,
    dailyMinutes,
    quietHoursEnabled: limits.quietHoursEnabled === true,
    quietStart: timePattern.test(limits.quietStart || '') ? limits.quietStart : defaultSettings.viewingLimits.quietStart,
    quietEnd: timePattern.test(limits.quietEnd || '') ? limits.quietEnd : defaultSettings.viewingLimits.quietEnd,
  };
}

function validateImportSettings(rawSettings) {
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) {
    throw new Error('Import file must be a JSON object.');
  }
  if (rawSettings.approvedChannels !== undefined && !Array.isArray(rawSettings.approvedChannels)) {
    throw new Error('Import file has invalid approvedChannels. Expected an array.');
  }
  if (rawSettings.approvedVideos !== undefined && !Array.isArray(rawSettings.approvedVideos)) {
    throw new Error('Import file has invalid approvedVideos. Expected an array.');
  }
  if (Array.isArray(rawSettings.approvedVideos) && rawSettings.approvedVideos.some((id) => !videoIdPattern.test(String(id || '').trim()))) {
    throw new Error('Import file has an invalid approved video ID.');
  }
  if (rawSettings.approvedVideoDetails !== undefined && (!rawSettings.approvedVideoDetails || typeof rawSettings.approvedVideoDetails !== 'object' || Array.isArray(rawSettings.approvedVideoDetails))) {
    throw new Error('Import file has invalid approvedVideoDetails. Expected an object.');
  }
  if (rawSettings.blockedChannels !== undefined && !Array.isArray(rawSettings.blockedChannels)) {
    throw new Error('Import file has invalid blockedChannels. Expected an array.');
  }
  if (Array.isArray(rawSettings.blockedChannels) && rawSettings.blockedChannels.some((id) => !channelIdPattern.test(String(id || '').trim()))) {
    throw new Error('Import file has an invalid blocked channel ID.');
  }
  if (rawSettings.hiddenVideos !== undefined && !Array.isArray(rawSettings.hiddenVideos)) {
    throw new Error('Import file has invalid hiddenVideos. Expected an array.');
  }
  if (Array.isArray(rawSettings.hiddenVideos) && rawSettings.hiddenVideos.some((id) => !videoIdPattern.test(String(id || '').trim()))) {
    throw new Error('Import file has an invalid hidden video ID.');
  }
  if (rawSettings.hiddenVideoDetails !== undefined && (!rawSettings.hiddenVideoDetails || typeof rawSettings.hiddenVideoDetails !== 'object' || Array.isArray(rawSettings.hiddenVideoDetails))) {
    throw new Error('Import file has invalid hiddenVideoDetails. Expected an object.');
  }
  if (rawSettings.favoriteVideos !== undefined && !Array.isArray(rawSettings.favoriteVideos)) {
    throw new Error('Import file has invalid favoriteVideos. Expected an array.');
  }
  if (Array.isArray(rawSettings.favoriteVideos) && rawSettings.favoriteVideos.some((id) => !videoIdPattern.test(String(id || '').trim()))) {
    throw new Error('Import file has an invalid favorite video ID.');
  }
  if (rawSettings.favoriteVideoDetails !== undefined && (!rawSettings.favoriteVideoDetails || typeof rawSettings.favoriteVideoDetails !== 'object' || Array.isArray(rawSettings.favoriteVideoDetails))) {
    throw new Error('Import file has invalid favoriteVideoDetails. Expected an object.');
  }
  if (rawSettings.recentlyWatched !== undefined && !Array.isArray(rawSettings.recentlyWatched)) {
    throw new Error('Import file has invalid recentlyWatched. Expected an array.');
  }
  if (rawSettings.usageByDate !== undefined && (!rawSettings.usageByDate || typeof rawSettings.usageByDate !== 'object' || Array.isArray(rawSettings.usageByDate))) {
    throw new Error('Import file has invalid usageByDate. Expected an object.');
  }
  if (rawSettings.viewingLimits !== undefined && (!rawSettings.viewingLimits || typeof rawSettings.viewingLimits !== 'object' || Array.isArray(rawSettings.viewingLimits))) {
    throw new Error('Import file has invalid viewingLimits. Expected an object.');
  }
  if (rawSettings.categories !== undefined && !Array.isArray(rawSettings.categories)) {
    throw new Error('Import file has invalid categories. Expected an array.');
  }
  if (Array.isArray(rawSettings.approvedChannels)) {
    const invalidChannel = rawSettings.approvedChannels.find((channel) => (
      !channel || typeof channel !== 'object' || typeof channel.id !== 'string' || !channelIdPattern.test(channel.id.trim())
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
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (isDev) return parsed.origin === 'http://127.0.0.1:5173';
    parsed.hash = '';
    parsed.search = '';
    return parsed.href === pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
  } catch (_error) {
    return false;
  }
}

function isAllowedFrameUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname === 'www.youtube-nocookie.com') return parsed.pathname.startsWith('/embed/');
    return parsed.hostname === 'www.youtube.com' && parsed.pathname.startsWith('/embed/');
  } catch (_error) {
    return false;
  }
}

function frameNavigationDetails(urlOrDetails, isMainFrame) {
  if (urlOrDetails && typeof urlOrDetails === 'object') {
    return { url: urlOrDetails.url, isMainFrame: urlOrDetails.isMainFrame === true };
  }
  return { url: urlOrDetails, isMainFrame: isMainFrame === true };
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

function extractChannelIdFromHtml(html) {
  const normalized = String(html || '').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  const patterns = [
    /youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})(?![a-zA-Z0-9_-])/,
    /"externalId"\s*:\s*"(UC[a-zA-Z0-9_-]{22})"/,
    /"channelId"\s*:\s*"(UC[a-zA-Z0-9_-]{22})"/,
    /"browseId"\s*:\s*"(UC[a-zA-Z0-9_-]{22})"/,
  ];
  return patterns.map((pattern) => normalized.match(pattern)?.[1]).find(Boolean) || '';
}

async function resolveChannelFromPage(input) {
  const trimmed = String(input || '').trim();
  const handle = trimmed.match(/@([a-zA-Z0-9_.-]+)/)?.[0];
  if (!handle) return null;
  const response = await fetch(`https://www.youtube.com/${encodeURIComponent(handle)}`, {
    headers: {
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`YouTube channel page request failed: ${response.status}`);
  const html = await response.text();
  const id = extractChannelIdFromHtml(html);
  if (!id) return null;
  const title = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1]
    || html.match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(/\s*-\s*YouTube\s*$/i, '')
    || id;
  return { id, title };
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
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    return { action: 'deny' };
  });

  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppUrl(url)) event.preventDefault();
  });

  win.webContents.on('will-frame-navigate', (event, urlOrDetails, _isInPlace, isMainFrame) => {
    const details = frameNavigationDetails(urlOrDetails, isMainFrame);
    if (details.isMainFrame && !isAllowedAppUrl(details.url)) event.preventDefault();
    if (!details.isMainFrame && !isAllowedFrameUrl(details.url)) event.preventDefault();
  });

  if (isDev) {
    win.loadURL('http://127.0.0.1:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  return win;
}

function startApp() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  let mainWindow;
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
  ipcMain.handle('settings:read', readSettings);
  ipcMain.handle('settings:write', (_event, settings) => writeSettings(settings));

  ipcMain.handle('settings:backup', async (_event, reason = 'manual') => {
    await backupCurrentSettings(String(reason).replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'manual');
    return { ok: true };
  });

  ipcMain.handle('settings:listBackups', () => listSettingBackups());

  ipcMain.handle('settings:restoreBackup', async (_event, fileName) => {
    const settings = await restoreSettingsBackup(String(fileName || ''));
    return { settings };
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
    const channelId = trimmed.match(/(UC[a-zA-Z0-9_-]{22})(?![a-zA-Z0-9_-])/)?.[1];
    if (channelId) return { id: channelId, title: channelId };
    if (/@[a-zA-Z0-9_.-]+/.test(trimmed)) {
      try {
        const resolved = await resolveChannelFromPage(trimmed);
        if (resolved) return resolved;
      } catch (error) {
        await appendLog('warn', 'Channel handle page resolution failed', { input: trimmed, error: error.message });
      }
    }
    if (!apiKey) return { needsApiKey: true };

    const handle = trimmed.match(/@([a-zA-Z0-9_.-]+)/)?.[0] || (trimmed.startsWith('@') ? trimmed : `@${trimmed}`);
    const handleParams = new URLSearchParams({
      part: 'snippet',
      forHandle: handle,
      key: apiKey,
    });
    const handleResponse = await fetch(`https://www.googleapis.com/youtube/v3/channels?${handleParams.toString()}`, { signal: AbortSignal.timeout(15000) });
    if (handleResponse.ok) {
      const handleData = await handleResponse.json();
      const channel = handleData.items?.[0];
      if (channel?.id) return { id: channel.id, title: channel.snippet?.title || channel.id };
    }

    if (/@[a-zA-Z0-9_.-]+/.test(trimmed)) return { notFound: true };

    const searchParams = new URLSearchParams({
      part: 'snippet',
      q: trimmed.replace(/^@/, ''),
      type: 'channel',
      maxResults: '1',
      safeSearch: 'strict',
      key: apiKey,
    });
    const searchResponse = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams.toString()}`, { signal: AbortSignal.timeout(15000) });
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
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`, { signal: AbortSignal.timeout(15000) });
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
    const detailResponse = await fetch(`https://www.googleapis.com/youtube/v3/channels?${detailParams.toString()}`, { signal: AbortSignal.timeout(15000) });
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

  mainWindow = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

if (process.versions.electron || require.main === module) startApp();

module.exports = {
  canTest: true,
  extractChannelIdFromHtml,
  frameNavigationDetails,
  isAllowedAppUrl,
  isAllowedFrameUrl,
  migrateSettings,
  normalizeViewingLimits,
  parseFeedEntries,
  validateImportSettings,
};
