import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backupPanelState,
  channelApprovalState,
  emptySettings,
  filterDiscoveryResults,
  modeForAdminOpen,
  nextReviewStateAfterChannelDecision,
} from '../src/appLogic.mjs';

test('PIN flow opens admin directly until a PIN is set', () => {
  assert.equal(modeForAdminOpen(emptySettings, false), 'admin');
  assert.equal(modeForAdminOpen({ ...emptySettings, pinHash: 'hash' }, false), 'unlock');
  assert.equal(modeForAdminOpen({ ...emptySettings, pinHash: 'hash' }, true), 'admin');
});

test('approval flow identifies duplicate and blocked channels', () => {
  const settings = {
    ...emptySettings,
    approvedChannels: [{ id: 'UCapproved00000000000000', title: 'Approved' }],
    blockedChannels: ['UCblocked000000000000000'],
  };

  assert.equal(channelApprovalState(settings, 'UCapproved00000000000000'), 'already-approved');
  assert.equal(channelApprovalState(settings, 'UCblocked000000000000000'), 'blocked-until-approved');
  assert.equal(channelApprovalState(settings, 'UCnewchannel0000000000000'), 'ready');
});

test('blacklist flow hides approved and blocked discovery candidates', () => {
  const visible = filterDiscoveryResults(
    [
      { id: 'UCapproved00000000000000', title: 'Approved' },
      { id: 'UCblocked000000000000000', title: 'Blocked' },
      { id: 'UCfresh00000000000000000', title: 'Fresh' },
    ],
    [{ id: 'UCapproved00000000000000' }],
    ['UCblocked000000000000000'],
  );

  assert.deepEqual(visible, [{ id: 'UCfresh00000000000000000', title: 'Fresh' }]);
});

test('review flow clears the selected candidate after approval or blacklist', () => {
  assert.deepEqual(nextReviewStateAfterChannelDecision({ id: 'UCreview0000000000000000' }, 'UCreview0000000000000000'), {
    reviewChannel: null,
    reviewVideos: [],
  });
  assert.equal(nextReviewStateAfterChannelDecision({ id: 'UCother00000000000000000' }, 'UCreview0000000000000000'), null);
});

test('backup flow reports loading, empty, and populated states', () => {
  assert.equal(backupPanelState([], true), 'loading');
  assert.equal(backupPanelState([], false), 'empty');
  assert.equal(backupPanelState([{ fileName: 'settings.json' }], false), 'has-backups');
});
