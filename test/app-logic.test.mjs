import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approvedVideoFromInput,
  canPlayVideo,
  normalizeChannelId,
  normalizeVideoId,
  parseBulkChannelLine,
} from '../src/appLogic.mjs';

test('normalizeChannelId extracts UC IDs from URLs', () => {
  assert.equal(
    normalizeChannelId('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'),
    'UCabcdefghijklmnopqrstuv',
  );
});

test('normalizeVideoId accepts YouTube URLs and bare IDs', () => {
  assert.equal(normalizeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(normalizeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(normalizeVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(normalizeVideoId('not a video'), '');
});

test('parseBulkChannelLine handles title and channel formats', () => {
  assert.deepEqual(parseBulkChannelLine('Bluey | @BlueyOfficialChannel'), {
    id: '@BlueyOfficialChannel',
    title: 'Bluey',
  });
  assert.deepEqual(parseBulkChannelLine('@BlueyOfficialChannel | Bluey'), {
    id: '@BlueyOfficialChannel',
    title: 'Bluey',
  });
  assert.equal(parseBulkChannelLine('   '), null);
});

test('approvedVideoFromInput creates display metadata', () => {
  const video = approvedVideoFromInput({
    id: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    title: 'Safe Song',
    channelTitle: 'Safe Channel',
    category: 'Music',
  });
  assert.equal(video.id, 'dQw4w9WgXcQ');
  assert.equal(video.title, 'Safe Song');
  assert.equal(video.channelTitle, 'Safe Channel');
  assert.equal(video.category, 'Music');
  assert.equal(video.thumbnail, 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
});

test('canPlayVideo allows enabled approved channels and standalone approved videos only', () => {
  const enabledChannels = new Set(['UCsafechannel000000000000']);
  const approvedVideos = new Set(['standalone01']);
  const hiddenVideos = new Set(['hiddenvideo1']);

  assert.equal(canPlayVideo({ id: 'feedvideo01', channelId: 'UCsafechannel000000000000' }, enabledChannels, approvedVideos, hiddenVideos), true);
  assert.equal(canPlayVideo({ id: 'standalone01', channelId: 'UCunknownchannel0000000' }, enabledChannels, approvedVideos, hiddenVideos), true);
  assert.equal(canPlayVideo({ id: 'hiddenvideo1', channelId: 'UCsafechannel000000000000' }, enabledChannels, approvedVideos, hiddenVideos), false);
  assert.equal(canPlayVideo({ id: 'other-video', channelId: 'UCunknownchannel0000000' }, enabledChannels, approvedVideos, hiddenVideos), false);
});
