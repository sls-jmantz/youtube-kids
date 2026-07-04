export const emptySettings = {
  schemaVersion: 7,
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

export function todayKey() {
  return new Date().toLocaleDateString('en-CA');
}

export function minutesForTime(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours * 60) + minutes;
}

export function isWithinQuietHours(limits) {
  if (!limits.quietHoursEnabled) return false;
  const now = new Date();
  const current = (now.getHours() * 60) + now.getMinutes();
  const start = minutesForTime(limits.quietStart || '20:00');
  const end = minutesForTime(limits.quietEnd || '07:00');
  return start <= end ? current >= start && current < end : current >= start || current < end;
}

export function viewingStatus(settings) {
  const limits = settings.viewingLimits;
  const usedToday = settings.usageByDate[todayKey()] || 0;
  if (!limits.enabled) return { blocked: false, usedToday, reason: '' };
  if (isWithinQuietHours(limits)) return { blocked: true, usedToday, reason: 'Quiet hours are active.' };
  if (usedToday >= limits.dailyMinutes) return { blocked: true, usedToday, reason: 'Daily viewing limit reached.' };
  return { blocked: false, usedToday, reason: '' };
}

export function parseFeed(xmlText, channel) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const textFor = (entry, localName) => Array.from(entry.getElementsByTagName('*'))
    .find((node) => node.localName === localName)?.textContent || '';
  const attrFor = (entry, localName, attrName) => Array.from(entry.getElementsByTagName('*'))
    .find((node) => node.localName === localName)?.getAttribute(attrName) || '';
  return Array.from(doc.querySelectorAll('entry')).map((entry) => ({
    id: textFor(entry, 'videoId'),
    title: textFor(entry, 'title') || 'Untitled video',
    channelId: channel.id,
    channelTitle: channel.title,
    published: textFor(entry, 'published'),
    thumbnail: attrFor(entry, 'thumbnail', 'url'),
  })).filter((video) => video.id);
}

export function normalizeChannelId(input) {
  const trimmed = input.trim();
  const match = trimmed.match(/(UC[a-zA-Z0-9_-]{20,})/);
  return match ? match[1] : trimmed;
}

export function normalizeVideoId(input) {
  const trimmed = input.trim();
  const match = trimmed.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/) || trimmed.match(/^([a-zA-Z0-9_-]{11})$/);
  return match ? match[1] : '';
}

export function parseBulkChannelLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('|').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { id: trimmed, title: '' };
  const firstLooksLikeChannel = /UC[a-zA-Z0-9_-]{20,}|@|youtube\.com|youtu\.be/.test(parts[0]);
  return firstLooksLikeChannel
    ? { id: parts[0], title: parts.slice(1).join(' | ') }
    : { id: parts.slice(1).join(' | '), title: parts[0] };
}

export function createApprovedChannel(channel, fallbackTitle = '') {
  const now = new Date().toISOString();
  return {
    id: channel.id,
    title: channel.title || fallbackTitle || channel.id,
    thumbnail: channel.thumbnail || '',
    language: channel.language || 'en',
    category: channel.category || 'Learning',
    notes: channel.notes || '',
    enabled: channel.enabled !== false,
    approvedAt: channel.approvedAt || now,
    lastReviewedAt: channel.lastReviewedAt || '',
  };
}

export function videoSnapshot(video, dateField) {
  return {
    id: video.id,
    title: video.title,
    channelTitle: video.channelTitle,
    channelId: video.channelId,
    thumbnail: video.thumbnail,
    [dateField]: new Date().toISOString(),
  };
}

export function approvedVideoFromInput({ id, title, channelTitle, category }) {
  const videoId = normalizeVideoId(id);
  return {
    id: videoId,
    title: title.trim() || videoId,
    channelTitle: channelTitle.trim() || 'Approved Video',
    channelId: '',
    thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    category: category || 'Learning',
    approvedAt: new Date().toISOString(),
  };
}

export function canPlayVideo(video, enabledChannelIds, approvedVideoIds, hiddenVideoIds) {
  if (!video || hiddenVideoIds.has(video.id)) return false;
  return enabledChannelIds.has(video.channelId) || approvedVideoIds.has(video.id);
}

export function modeForAdminOpen(settings, adminUnlocked) {
  return !settings.pinHash || adminUnlocked ? 'admin' : 'unlock';
}

export function filterDiscoveryResults(items, approvedChannels, blockedChannels) {
  const approvedIds = new Set(approvedChannels.map((channel) => channel.id));
  const blockedIds = new Set(blockedChannels);
  return items.filter((item) => !approvedIds.has(item.id) && !blockedIds.has(item.id));
}

export function channelApprovalState(settings, channelId) {
  if (settings.approvedChannels.some((channel) => channel.id === channelId)) return 'already-approved';
  if (settings.blockedChannels.includes(channelId)) return 'blocked-until-approved';
  return 'ready';
}

export function nextReviewStateAfterChannelDecision(reviewChannel, channelId) {
  return reviewChannel?.id === channelId ? { reviewChannel: null, reviewVideos: [] } : null;
}

export function backupPanelState(backups, loading) {
  if (loading) return 'loading';
  return backups.length > 0 ? 'has-backups' : 'empty';
}
