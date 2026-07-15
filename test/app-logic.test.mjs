import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approvedVideoFromInput,
  canPlayVideo,
  isValidChannelId,
  normalizeChannelId,
  normalizeVideoId,
  parseBulkChannelLine,
} from '../src/appLogic.mjs';

test('normalizeChannelId extracts UC IDs from URLs', () => {
  assert.equal(
    normalizeChannelId('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'),
    'UCabcdefghijklmnopqrstuv',
  );
  assert.equal(isValidChannelId('UCabcdefghijklmnopqrstuv'), true);
  assert.equal(isValidChannelId('UCtooShort'), false);
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
  const enabledChannels = new Set(['UCabcdefghijklmnopqrstuv']);
  const approvedVideos = new Set(['standalone1']);
  const hiddenVideos = new Set(['hiddenvide1']);

  assert.equal(canPlayVideo({ id: 'feedvideo01', channelId: 'UCabcdefghijklmnopqrstuv' }, enabledChannels, approvedVideos, hiddenVideos), true);
  assert.equal(canPlayVideo({ id: 'standalone1', channelId: 'UCzyxwvutsrqponmlkjihgfe' }, enabledChannels, approvedVideos, hiddenVideos), true);
  assert.equal(canPlayVideo({ id: 'hiddenvide1', channelId: 'UCabcdefghijklmnopqrstuv' }, enabledChannels, approvedVideos, hiddenVideos), false);
  assert.equal(canPlayVideo({ id: 'other-video1', channelId: 'UCzyxwvutsrqponmlkjihgfe' }, enabledChannels, approvedVideos, hiddenVideos), false);
});
