const assert = require('node:assert/strict');
const test = require('node:test');
const {
  extractChannelIdFromHtml,
  migrateSettings,
  normalizeViewingLimits,
  parseFeedEntries,
  validateImportSettings,
} = require('../electron/main.cjs');

test('extractChannelIdFromHtml recognizes public channel page markers', () => {
  const channelId = 'UCabcdefghijklmnopqrstuv';
  assert.equal(extractChannelIdFromHtml(`<link rel="canonical" href="https://www.youtube.com/channel/${channelId}">`), channelId);
  assert.equal(extractChannelIdFromHtml(`{"externalId":"${channelId}"}`), channelId);
  assert.equal(extractChannelIdFromHtml(`{"channelId":"${channelId}"}`), channelId);
  assert.equal(extractChannelIdFromHtml(`{"browseId":"${channelId}"}`), channelId);
  assert.equal(extractChannelIdFromHtml('<html>No channel marker</html>'), '');
});

test('migrateSettings normalizes schema and approved video metadata', () => {
  const { settings, needsWrite } = migrateSettings({
    schemaVersion: 4,
    approvedChannels: [{ id: 'UCsafechannel000000000000', title: 'Safe', enabled: false }],
    approvedVideos: ['dQw4w9WgXcQ', 'dQw4w9WgXcQ', ''],
    approvedVideoDetails: {
      dQw4w9WgXcQ: { title: 'Safe Video', channelTitle: 'Safe Channel', category: 'Music' },
      staleVideo01: { title: 'Should Drop' },
    },
    viewingLimits: { enabled: true, dailyMinutes: 9999, quietStart: 'bad', quietEnd: '06:30' },
  });

  assert.equal(needsWrite, true);
  assert.equal(settings.schemaVersion, 7);
  assert.equal(settings.approvedChannels[0].enabled, false);
  assert.deepEqual(settings.approvedVideos, ['dQw4w9WgXcQ']);
  assert.equal(settings.approvedVideoDetails.dQw4w9WgXcQ.title, 'Safe Video');
  assert.equal(settings.approvedVideoDetails.dQw4w9WgXcQ.category, 'Music');
  assert.equal(settings.approvedVideoDetails.staleVideo01, undefined);
  assert.equal(settings.viewingLimits.dailyMinutes, 720);
  assert.equal(settings.viewingLimits.quietStart, '20:00');
  assert.equal(settings.viewingLimits.quietEnd, '06:30');
});

test('normalizeViewingLimits clamps minutes and validates times', () => {
  assert.deepEqual(normalizeViewingLimits({ enabled: true, dailyMinutes: -1, quietHoursEnabled: true, quietStart: '21:15', quietEnd: 'bad' }), {
    enabled: true,
    dailyMinutes: 1,
    quietHoursEnabled: true,
    quietStart: '21:15',
    quietEnd: '07:00',
  });
});

test('validateImportSettings rejects invalid allowlist shapes', () => {
  assert.throws(() => validateImportSettings({ approvedVideos: 'dQw4w9WgXcQ' }), /approvedVideos/);
  assert.throws(() => validateImportSettings({ approvedChannels: [{ id: 'not-a-channel' }] }), /valid UC channel ID/);
});

test('parseFeedEntries extracts video IDs, titles, dates, and thumbnails', () => {
  const videos = parseFeedEntries(`
    <feed>
      <entry>
        <yt:videoId>abc123video1</yt:videoId>
        <title><![CDATA[Safe Title]]></title>
        <published>2026-01-02T03:04:05+00:00</published>
        <media:thumbnail url="https://img.example/thumb.jpg" />
      </entry>
    </feed>
  `);
  assert.deepEqual(videos, [{
    id: 'abc123video1',
    title: 'Safe Title',
    published: '2026-01-02T03:04:05+00:00',
    thumbnail: 'https://img.example/thumb.jpg',
  }]);
});
