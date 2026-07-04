const { app, BrowserWindow, ipcMain, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const isDev = !app.isPackaged;

const defaultSettings = {
  approvedChannels: [],
  blockedChannels: [],
  language: 'en',
  pinHash: '',
  pinSalt: '',
  region: 'US',
  youtubeApiKey: '',
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function readSettings() {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return defaultSettings;
  }
}

async function writeSettings(settings) {
  const nextSettings = { ...defaultSettings, ...settings };
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(nextSettings, null, 2));
  return nextSettings;
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
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
    if (!response.ok) throw new Error(`Feed request failed: ${response.status}`);
    return response.text();
  });

  ipcMain.handle('youtube:channelVideos', async (_event, channelId) => {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
    if (!response.ok) throw new Error(`Preview request failed: ${response.status}`);
    const videos = parseFeedEntries(await response.text());
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
    if (!searchResponse.ok) throw new Error(`Channel lookup failed: ${searchResponse.status}`);
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
    if (!response.ok) throw new Error(`Discovery request failed: ${response.status}`);
    const data = await response.json();
    const channelIds = (data.items || []).map((item) => item.id.channelId).filter(Boolean);
    if (channelIds.length === 0) return { needsApiKey: false, items: [] };
    const detailParams = new URLSearchParams({
      part: 'snippet,brandingSettings',
      id: channelIds.join(','),
      key: apiKey,
    });
    const detailResponse = await fetch(`https://www.googleapis.com/youtube/v3/channels?${detailParams.toString()}`);
    if (!detailResponse.ok) throw new Error(`Channel detail request failed: ${detailResponse.status}`);
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
