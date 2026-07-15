import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import {
  approvedVideoFromInput,
  canPlayVideo,
  backupPanelState,
  channelApprovalState,
  createApprovedChannel,
  emptySettings,
  filterDiscoveryResults,
  isValidChannelId,
  modeForAdminOpen,
  normalizeChannelId,
  normalizeVideoId,
  nextReviewStateAfterChannelDecision,
  parseBulkChannelLine,
  parseFeed,
  todayKey,
  videoSnapshot,
  viewingStatus,
} from './appLogic.mjs';

function App() {
  const [settings, setSettings] = useState(emptySettings);
  const settingsRef = useRef(emptySettings);
  const settingsWriteQueueRef = useRef(Promise.resolve());
  const settingsRevisionRef = useRef(0);
  const reviewRequestRef = useRef(0);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedChannelId, setSelectedChannelId] = useState('All');
  const [quickFilter, setQuickFilter] = useState('All');
  const [mode, setMode] = useState('watch');
  const [channelIdInput, setChannelIdInput] = useState('');
  const [channelTitleInput, setChannelTitleInput] = useState('');
  const [bulkChannelInput, setBulkChannelInput] = useState('');
  const [videoIdInput, setVideoIdInput] = useState('');
  const [videoTitleInput, setVideoTitleInput] = useState('');
  const [videoChannelInput, setVideoChannelInput] = useState('');
  const [videoCategoryInput, setVideoCategoryInput] = useState('Learning');
  const [categoryInput, setCategoryInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('nursery rhymes');
  const [discoverResults, setDiscoverResults] = useState([]);
  const [reviewChannel, setReviewChannel] = useState(null);
  const [reviewVideos, setReviewVideos] = useState([]);
  const [appLog, setAppLog] = useState('');
  const [backups, setBackups] = useState([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [videoLoadError, setVideoLoadError] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [status, setStatus] = useState('Loading settings...');

  useEffect(() => {
    window.appApi.readSettings().then((loaded) => {
      settingsRef.current = loaded;
      setSettings(loaded);
      setSettingsLoaded(true);
      if (loaded.pinHash && !adminUnlocked) setMode((current) => current === 'admin' ? 'unlock' : current);
      setStatus('Ready');
    }).catch((error) => {
      setSettingsLoaded(true);
      setStatus(error.message);
    });
  }, []);

  const feedChannelKey = settings.approvedChannels
    .filter((channel) => channel.enabled !== false)
    .map((channel) => `${channel.id}:${channel.title}`)
    .join('|');
  const approvedVideoKey = settings.approvedVideos.join('|');
  const hiddenVideoKey = settings.hiddenVideos.join('|');

  useEffect(() => {
    let cancelled = false;
    async function loadVideos() {
      const enabledChannels = settings.approvedChannels.filter((channel) => channel.enabled !== false);
      if (!enabledChannels.length) {
        setVideos([]);
        setSelectedVideo((current) => current && settings.approvedVideos.includes(current.id) ? current : null);
        setLoadingVideos(false);
        setVideoLoadError('');
        return;
      }
      setLoadingVideos(true);
      setVideoLoadError('');
      setStatus('Loading approved channel videos...');
      try {
        const feedResults = await Promise.allSettled(enabledChannels.map(async (channel) => {
          const feed = await window.appApi.fetchChannelFeed(channel.id);
          return {
            videos: parseFeed(feed.xmlText, channel),
            fromCache: feed.fromCache,
          };
        }));
        if (cancelled) return;
        const feeds = feedResults.filter((result) => result.status === 'fulfilled').map((result) => result.value);
        const failures = feedResults.filter((result) => result.status === 'rejected');
        const nextVideos = feeds.flatMap((feed) => feed.videos).sort((a, b) => new Date(b.published) - new Date(a.published));
        setVideos(nextVideos);
        setSelectedVideo((current) => current && (nextVideos.some((video) => video.id === current.id) || settings.approvedVideos.includes(current.id)) ? current : null);
        if (failures.length > 0) {
          const message = `${failures.length} approved channel feed${failures.length === 1 ? '' : 's'} could not be loaded.`;
          setVideoLoadError(message);
          setStatus(message);
        } else {
          setStatus(feeds.some((feed) => feed.fromCache) ? 'Ready using cached feeds for one or more channels.' : 'Ready');
        }
      } catch (error) {
        if (!cancelled) {
          setVideoLoadError(error.message);
          setStatus(error.message);
        }
      } finally {
        if (!cancelled) setLoadingVideos(false);
      }
    }
    loadVideos();
    return () => {
      cancelled = true;
    };
  }, [feedChannelKey]);

  const currentViewingStatus = viewingStatus(settings);

  useEffect(() => {
    const enabledIds = new Set(settings.approvedChannels.filter((channel) => channel.enabled !== false).map((channel) => channel.id));
    const allowed = canPlayVideo(selectedVideo, enabledIds, new Set(settings.approvedVideos), new Set(settings.hiddenVideos));
    if (mode !== 'watch' || !allowed || currentViewingStatus.blocked || !settings.viewingLimits.enabled) return undefined;
    const interval = window.setInterval(() => {
      const key = todayKey();
      updateSettings((currentSettings) => ({
          ...currentSettings,
          usageByDate: {
            ...currentSettings.usageByDate,
            [key]: (currentSettings.usageByDate[key] || 0) + 1,
          },
      }));
    }, 60000);
    return () => window.clearInterval(interval);
  }, [mode, selectedVideo, currentViewingStatus.blocked, settings.viewingLimits.enabled, feedChannelKey, approvedVideoKey, hiddenVideoKey]);

  function replaceSettings(nextSettings) {
    settingsRevisionRef.current += 1;
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
  }

  function updateSettings(updater) {
    const nextSettings = updater(settingsRef.current);
    const revision = settingsRevisionRef.current + 1;
    settingsRevisionRef.current = revision;
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    const operation = settingsWriteQueueRef.current.then(async () => {
      const saved = await window.appApi.writeSettings(nextSettings);
      if (settingsRevisionRef.current === revision) {
        settingsRef.current = saved;
        setSettings(saved);
      }
      return saved;
    });
    const safeOperation = operation.catch((error) => {
      setStatus(error.message);
      return settingsRef.current;
    });
    settingsWriteQueueRef.current = safeOperation;
    return safeOperation;
  }

  function saveSettings(nextSettings) {
    const changedEntries = Object.entries(nextSettings).filter(([key, value]) => settings[key] !== value);
    return updateSettings((current) => ({ ...current, ...Object.fromEntries(changedEntries) }));
  }

  function openAdmin() {
    if (!settingsLoaded) {
      setStatus('Settings are still loading.');
      return;
    }
    const nextMode = modeForAdminOpen(settings, adminUnlocked);
    if (nextMode === 'unlock') setPinInput('');
    setMode(nextMode);
  }

  async function unlockAdmin() {
    const valid = await window.appApi.verifyPin(pinInput);
    if (!valid) {
      setStatus('Incorrect PIN.');
      setPinInput('');
      return;
    }
    setAdminUnlocked(true);
    setPinInput('');
    setMode('admin');
    setStatus('Parent Admin unlocked.');
  }

  async function setParentPin() {
    try {
      await settingsWriteQueueRef.current;
      const saved = await window.appApi.setPin(newPinInput);
      replaceSettings(saved);
      setAdminUnlocked(true);
      setNewPinInput('');
      setStatus('Parent PIN saved.');
    } catch (error) {
      setStatus(error.message);
    }
  }

  function lockAdmin() {
    setAdminUnlocked(false);
    setPinInput('');
    setMode('watch');
    setStatus('Parent Admin locked.');
  }

  async function resolveChannelForApproval(channel) {
    let id = normalizeChannelId(channel.id);
    let title = channel.title?.trim() || id;
    if (!isValidChannelId(id)) {
      setStatus('Resolving channel handle...');
      const resolved = await window.appApi.resolveChannel({ input: channel.id, apiKey: settings.youtubeApiKey });
      if (resolved.needsApiKey) {
        throw new Error('Could not resolve that input without the API. Paste a UC channel ID or exact @handle, or add an API key for channel-name search.');
      }
      if (resolved.notFound || !resolved.id) {
        throw new Error('Could not find that channel. Try pasting the channel ID or exact @handle.');
      }
      id = resolved.id;
      title = channel.title?.trim() || resolved.title || id;
    }
    if (!isValidChannelId(id)) throw new Error('YouTube returned an invalid channel ID.');
    return { id, title };
  }

  async function addChannel(channel) {
    let resolvedChannel;
    try {
      resolvedChannel = await resolveChannelForApproval(channel);
    } catch (error) {
      setStatus(error.message);
      return;
    }
    const { id, title } = resolvedChannel;
    if (channelApprovalState(settings, id) === 'already-approved') {
      setStatus('That channel is already approved.');
      return;
    }
    await saveSettings({
      ...settings,
      approvedChannels: [...settings.approvedChannels, createApprovedChannel({ ...channel, id, title })],
      blockedChannels: settings.blockedChannels.filter((blockedId) => blockedId !== id),
    });
    setDiscoverResults((results) => results.filter((result) => result.id !== id));
    const nextReviewState = nextReviewStateAfterChannelDecision(reviewChannel, id);
    if (nextReviewState) {
      setReviewChannel(nextReviewState.reviewChannel);
      setReviewVideos(nextReviewState.reviewVideos);
    }
    setChannelIdInput('');
    setChannelTitleInput('');
    setStatus(`Approved ${title}`);
  }

  async function addBulkChannels() {
    const candidates = bulkChannelInput.split('\n').map(parseBulkChannelLine).filter(Boolean);
    if (candidates.length === 0) {
      setStatus('Paste at least one channel to bulk approve.');
      return;
    }

    const approvedIds = new Set(settings.approvedChannels.map((channel) => channel.id));
    const nextApprovedChannels = [...settings.approvedChannels];
    const nextBlockedChannels = [...settings.blockedChannels];
    let added = 0;
    let skipped = 0;
    let failed = 0;

    for (const candidate of candidates) {
      try {
        const { id, title } = await resolveChannelForApproval(candidate);
        if (approvedIds.has(id)) {
          skipped += 1;
          continue;
        }
        approvedIds.add(id);
        nextApprovedChannels.push(createApprovedChannel({ ...candidate, id, title }));
        const blockedIndex = nextBlockedChannels.indexOf(id);
        if (blockedIndex >= 0) nextBlockedChannels.splice(blockedIndex, 1);
        added += 1;
      } catch (_error) {
        failed += 1;
      }
    }

    if (added > 0) {
      await saveSettings({
        ...settings,
        approvedChannels: nextApprovedChannels,
        blockedChannels: nextBlockedChannels,
      });
      setDiscoverResults((results) => results.filter((result) => !approvedIds.has(result.id)));
      setBulkChannelInput('');
    }
    setStatus(`Bulk approval complete: ${added} added, ${skipped} skipped, ${failed} failed.`);
  }

  async function removeChannel(channelId) {
    await window.appApi.backupSettings('before-remove-channel');
    await saveSettings({
      ...settings,
      approvedChannels: settings.approvedChannels.filter((channel) => channel.id !== channelId),
    });
    setStatus('Channel removed.');
  }

  async function updateApprovedChannel(channelId, updates) {
    await saveSettings({
      ...settings,
      approvedChannels: settings.approvedChannels.map((channel) => (
        channel.id === channelId ? { ...channel, ...updates } : channel
      )),
    });
  }

  async function addCategory() {
    const category = categoryInput.trim();
    if (!category) return;
    if (settings.categories.includes(category)) {
      setStatus('That category already exists.');
      return;
    }
    await saveSettings({ ...settings, categories: [...settings.categories, category] });
    setCategoryInput('');
    setStatus(`Added category ${category}.`);
  }

  async function addApprovedVideo() {
    const videoId = normalizeVideoId(videoIdInput);
    if (!videoId) {
      setStatus('Paste a YouTube video URL or 11-character video ID.');
      return;
    }
    if (settings.approvedVideos.includes(videoId)) {
      setStatus('That video is already approved.');
      return;
    }
    const video = approvedVideoFromInput({
      id: videoId,
      title: videoTitleInput,
      channelTitle: videoChannelInput,
      category: videoCategoryInput,
    });
    await saveSettings({
      ...settings,
      approvedVideos: [...settings.approvedVideos, videoId],
      approvedVideoDetails: {
        ...settings.approvedVideoDetails,
        [videoId]: video,
      },
      hiddenVideos: settings.hiddenVideos.filter((hiddenId) => hiddenId !== videoId),
    });
    setVideoIdInput('');
    setVideoTitleInput('');
    setVideoChannelInput('');
    setStatus(`Approved video ${video.title}.`);
  }

  async function removeApprovedVideo(videoId) {
    await window.appApi.backupSettings('before-remove-approved-video');
    const { [videoId]: _removed, ...nextApprovedVideoDetails } = settings.approvedVideoDetails;
    await saveSettings({
      ...settings,
      approvedVideos: settings.approvedVideos.filter((approvedId) => approvedId !== videoId),
      approvedVideoDetails: nextApprovedVideoDetails,
    });
    setSelectedVideo((current) => current?.id === videoId ? null : current);
    setStatus('Approved video removed.');
  }

  async function removeCategory(category) {
    if (settings.categories.length <= 1) {
      setStatus('Keep at least one category.');
      return;
    }
    await window.appApi.backupSettings('before-remove-category');
    const fallback = settings.categories.find((item) => item !== category) || 'Learning';
    await saveSettings({
      ...settings,
      categories: settings.categories.filter((item) => item !== category),
      approvedChannels: settings.approvedChannels.map((channel) => (
        channel.category === category ? { ...channel, category: fallback } : channel
      )),
      approvedVideoDetails: Object.fromEntries(Object.entries(settings.approvedVideoDetails).map(([videoId, video]) => [videoId, {
        ...video,
        category: video.category === category ? fallback : video.category,
      }])),
    });
    if (selectedCategory === category) setSelectedCategory('All');
    setStatus(`Removed category ${category}.`);
  }

  async function exportSettings() {
    try {
      await settingsWriteQueueRef.current;
      const result = await window.appApi.exportSettings();
      if (!result.canceled) setStatus(`Settings exported to ${result.filePath}`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function importSettings() {
    try {
      await settingsWriteQueueRef.current;
      const result = await window.appApi.importSettings();
      if (result.canceled) return;
      replaceSettings(result.settings);
      setSelectedCategory('All');
      setSelectedChannelId('All');
      setDiscoverResults([]);
      setReviewChannel(null);
      setReviewVideos([]);
      setStatus(`Settings imported from ${result.filePath}`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function loadBackups() {
    setBackupLoading(true);
    try {
      const snapshots = await window.appApi.listBackups();
      setBackups(snapshots);
      setStatus(`Found ${snapshots.length} backup snapshots.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBackupLoading(false);
    }
  }

  async function restoreBackup(fileName) {
    try {
      await settingsWriteQueueRef.current;
      const result = await window.appApi.restoreBackup(fileName);
      replaceSettings(result.settings);
      setSelectedCategory('All');
      setSelectedChannelId('All');
      setDiscoverResults([]);
      setReviewChannel(null);
      setReviewVideos([]);
      await loadBackups();
      setStatus(`Restored backup ${fileName}.`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function hideVideo(video) {
    if (settings.hiddenVideos.includes(video.id)) return;
    const nextHiddenVideos = [...settings.hiddenVideos, video.id];
    await saveSettings({
      ...settings,
      hiddenVideos: nextHiddenVideos,
      hiddenVideoDetails: {
        ...settings.hiddenVideoDetails,
        [video.id]: {
          id: video.id,
          title: video.title,
          channelTitle: video.channelTitle,
          channelId: video.channelId,
          thumbnail: video.thumbnail,
          hiddenAt: new Date().toISOString(),
        },
      },
    });
    setSelectedVideo((current) => current?.id === video.id ? null : current);
    setStatus(`Hidden ${video.title}.`);
  }

  async function playVideo(video) {
    if (currentViewingStatus.blocked) {
      setStatus(currentViewingStatus.reason);
      return;
    }
    setSelectedVideo(video);
    const snapshot = videoSnapshot(video, 'watchedAt');
    await saveSettings({
      ...settings,
      recentlyWatched: [snapshot, ...settings.recentlyWatched.filter((item) => item.id !== video.id)].slice(0, 50),
    });
  }

  async function toggleFavorite(video) {
    const isFavorite = settings.favoriteVideos.includes(video.id);
    if (isFavorite) {
      const { [video.id]: _removed, ...nextFavoriteVideoDetails } = settings.favoriteVideoDetails;
      await saveSettings({
        ...settings,
        favoriteVideos: settings.favoriteVideos.filter((videoId) => videoId !== video.id),
        favoriteVideoDetails: nextFavoriteVideoDetails,
      });
      setStatus('Removed from favorites.');
      return;
    }
    await saveSettings({
      ...settings,
      favoriteVideos: [...settings.favoriteVideos, video.id],
      favoriteVideoDetails: {
        ...settings.favoriteVideoDetails,
        [video.id]: videoSnapshot(video, 'favoritedAt'),
      },
    });
    setStatus(`Added ${video.title} to favorites.`);
  }

  async function unhideVideo(videoId) {
    const { [videoId]: _removed, ...nextHiddenVideoDetails } = settings.hiddenVideoDetails;
    await saveSettings({
      ...settings,
      hiddenVideos: settings.hiddenVideos.filter((hiddenId) => hiddenId !== videoId),
      hiddenVideoDetails: nextHiddenVideoDetails,
    });
    setStatus('Video restored.');
  }

  async function loadAppLog() {
    setLogLoading(true);
    try {
      const logText = await window.appApi.readLog();
      setAppLog(logText || 'No log entries yet.');
      setStatus('Loaded app log.');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLogLoading(false);
    }
  }

  async function blockChannel(channel) {
    if (settings.blockedChannels.includes(channel.id)) {
      setDiscoverResults((results) => results.filter((result) => result.id !== channel.id));
      setStatus('Channel already hidden from discovery.');
      return;
    }
    await saveSettings({
      ...settings,
      blockedChannels: [...settings.blockedChannels, channel.id],
    });
    const nextReviewState = nextReviewStateAfterChannelDecision(reviewChannel, channel.id);
    if (nextReviewState) {
      setReviewChannel(nextReviewState.reviewChannel);
      setReviewVideos(nextReviewState.reviewVideos);
    }
    setDiscoverResults((results) => results.filter((result) => result.id !== channel.id));
    setStatus(`Blacklisted ${channel.title}.`);
  }

  async function unblockChannel(channelId) {
    await saveSettings({
      ...settings,
      blockedChannels: settings.blockedChannels.filter((blockedId) => blockedId !== channelId),
    });
    setStatus('Channel removed from discovery blacklist.');
  }

  async function runDiscovery() {
    setDiscovering(true);
    setStatus('Searching English channels...');
    try {
      const result = await window.appApi.discoverChannels({
        query: searchQuery,
        language: settings.language,
        region: settings.region,
        apiKey: settings.youtubeApiKey,
      });
      if (result.needsApiKey) {
        setStatus('Discovery needs a YouTube Data API key. Manual channel approval works without one.');
        return;
      }
      const visibleItems = filterDiscoveryResults(result.items, settings.approvedChannels, settings.blockedChannels);
      setDiscoverResults(visibleItems);
      setReviewChannel(null);
      setReviewVideos([]);
      setStatus(`Found ${visibleItems.length} new English-region channel candidates.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setDiscovering(false);
    }
  }

  async function reviewCandidate(channel) {
    const requestId = reviewRequestRef.current + 1;
    reviewRequestRef.current = requestId;
    setReviewChannel(channel);
    setReviewVideos([]);
    setReviewLoading(true);
    setStatus(`Loading recent uploads for ${channel.title}...`);
    try {
      const recentVideos = await window.appApi.fetchChannelVideos(channel.id);
      if (reviewRequestRef.current !== requestId) return;
      setReviewVideos(recentVideos);
      setStatus(`Reviewing ${channel.title}.`);
    } catch (error) {
      if (reviewRequestRef.current !== requestId) return;
      setStatus(error.message);
    } finally {
      if (reviewRequestRef.current === requestId) setReviewLoading(false);
    }
  }

  useEffect(() => {
    if (selectedChannelId !== 'All' && !settings.approvedChannels.some((channel) => channel.id === selectedChannelId && channel.enabled !== false)) {
      setSelectedChannelId('All');
    }
    if (selectedCategory !== 'All' && !settings.categories.includes(selectedCategory)) setSelectedCategory('All');
    if (!settings.categories.includes(videoCategoryInput)) setVideoCategoryInput(settings.categories[0] || 'Learning');
  }, [settings.approvedChannels, settings.categories, selectedChannelId, selectedCategory, videoCategoryInput]);

  const approvedIds = new Set(settings.approvedChannels.map((channel) => channel.id));
  const enabledChannels = settings.approvedChannels.filter((channel) => channel.enabled !== false);
  const visibleChannels = selectedCategory === 'All'
    ? enabledChannels
    : enabledChannels.filter((channel) => (channel.category || 'Learning') === selectedCategory);
  const enabledApprovedIds = new Set(enabledChannels.map((channel) => channel.id));
  const approvedVideoIds = new Set(settings.approvedVideos);
  const hiddenVideoIds = new Set(settings.hiddenVideos);
  const favoriteVideoIds = new Set(settings.favoriteVideos);
  const approvedStandaloneVideos = settings.approvedVideos.map((videoId) => ({
    id: videoId,
    title: settings.approvedVideoDetails[videoId]?.title || videoId,
    channelTitle: settings.approvedVideoDetails[videoId]?.channelTitle || 'Approved Video',
    channelId: settings.approvedVideoDetails[videoId]?.channelId || '',
    thumbnail: settings.approvedVideoDetails[videoId]?.thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    category: settings.approvedVideoDetails[videoId]?.category || 'Learning',
    approvedAt: settings.approvedVideoDetails[videoId]?.approvedAt || '',
    standaloneApproved: true,
  }));
  const feedVideoIds = new Set(videos.map((video) => video.id));
  const savedVideoSnapshots = [
    ...Object.values(settings.favoriteVideoDetails),
    ...settings.recentlyWatched,
  ].filter((video) => video?.id);
  const knownVideoIds = new Set([...feedVideoIds, ...approvedStandaloneVideos.map((video) => video.id)]);
  const allVideos = [
    ...videos,
    ...approvedStandaloneVideos.filter((video) => !feedVideoIds.has(video.id)),
    ...savedVideoSnapshots.filter((video) => {
      if (knownVideoIds.has(video.id)) return false;
      knownVideoIds.add(video.id);
      return true;
    }),
  ];
  const visibleVideos = allVideos.filter((video) => canPlayVideo(video, enabledApprovedIds, approvedVideoIds, hiddenVideoIds));
  const canPlaySelectedVideo = canPlayVideo(selectedVideo, enabledApprovedIds, approvedVideoIds, hiddenVideoIds);
  const playableVideo = canPlaySelectedVideo && !hiddenVideoIds.has(selectedVideo.id) && !currentViewingStatus.blocked ? selectedVideo : null;
  const categoryByChannelId = new Map(settings.approvedChannels.map((channel) => [channel.id, channel.category || 'Learning']));
  const categoryForVideo = (video) => video.category || categoryByChannelId.get(video.channelId) || 'Learning';
  const backupState = backupPanelState(backups, backupLoading);
  const quickFilteredVideos = visibleVideos.filter((video) => {
    if (quickFilter === 'Favorites') return favoriteVideoIds.has(video.id);
    if (quickFilter === 'Recent') return settings.recentlyWatched.some((item) => item.id === video.id);
    return true;
  });
  const filteredVideos = quickFilteredVideos.filter((video) => (
    (selectedCategory === 'All' || categoryForVideo(video) === selectedCategory)
    && (selectedChannelId === 'All' || video.channelId === selectedChannelId)
  ));
  const categoryFilteredVideos = quickFilteredVideos.filter((video) => (
    selectedCategory === 'All' || categoryForVideo(video) === selectedCategory
  ));
  const hiddenVideoDetails = settings.hiddenVideos.map((videoId) => (
    allVideos.find((video) => video.id === videoId) || settings.hiddenVideoDetails[videoId] || { id: videoId, title: videoId, channelTitle: 'Unknown channel' }
  ));

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Approved Tube Kids</p>
          <h1>Only approved channels. No open browsing.</h1>
        </div>
        <nav className="mode-switcher" aria-label="App mode">
          <button className={mode === 'watch' ? 'active' : ''} onClick={() => setMode('watch')}>Watch</button>
          <button className={mode === 'admin' || mode === 'unlock' ? 'active' : ''} disabled={!settingsLoaded} onClick={openAdmin}>Parent Admin</button>
          {adminUnlocked && <button onClick={lockAdmin}>Lock Admin</button>}
        </nav>
        <section className="approved-box">
          <h2>Approved Channels</h2>
          {settings.approvedChannels.length === 0 ? (
            <p>No channels approved yet.</p>
          ) : settings.approvedChannels.map((channel) => (
            <div className="approved-channel" key={channel.id}>
              <span>{channel.title}</span>
              {mode === 'admin' && <button onClick={() => removeChannel(channel.id)}>Remove</button>}
            </div>
          ))}
        </section>
        <p className="status">{status}</p>
      </aside>

      {mode === 'watch' ? (
        <section className="watch-layout">
          <div className="player-card">
            {playableVideo ? (
              <iframe
                title={playableVideo.title}
                src={`https://www.youtube-nocookie.com/embed/${playableVideo.id}?rel=0&modestbranding=1${playableVideo.standaloneApproved ? `&loop=1&playlist=${playableVideo.id}` : ''}`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : currentViewingStatus.blocked ? (
              <div className="empty-player limit-player">
                <strong>{currentViewingStatus.reason}</strong>
                <span>{currentViewingStatus.usedToday} of {settings.viewingLimits.dailyMinutes} minutes used today.</span>
              </div>
            ) : (
              <div className="empty-player">Approve a channel or video to start watching.</div>
            )}
          </div>
          {settings.viewingLimits.enabled && (
            <div className="usage-banner">
              Today: {currentViewingStatus.usedToday} / {settings.viewingLimits.dailyMinutes} minutes
            </div>
          )}
          <div className="category-filter" aria-label="Video categories">
            {['All', 'Favorites', 'Recent'].map((filter) => (
              <button
                className={quickFilter === filter ? 'active' : ''}
                key={filter}
                onClick={() => {
                  setQuickFilter(filter);
                  setSelectedChannelId('All');
                }}
              >
                {filter}
              </button>
            ))}
          </div>
          <div className="category-filter secondary" aria-label="Video categories">
            {['All', ...settings.categories].map((category) => (
              <button
                className={selectedCategory === category ? 'active' : ''}
                key={category}
                onClick={() => {
                  setSelectedCategory(category);
                  setSelectedChannelId('All');
                }}
              >
                {category}
              </button>
            ))}
          </div>
          {visibleChannels.length > 0 && (
            <div className="channel-tile-grid" aria-label="Approved channels">
              <button className={`channel-tile ${selectedChannelId === 'All' ? 'active' : ''}`} onClick={() => setSelectedChannelId('All')}>
                <span className="channel-avatar">All</span>
                <strong>All Channels</strong>
                <small>{categoryFilteredVideos.length} videos</small>
              </button>
              {visibleChannels.map((channel) => {
                const videoCount = visibleVideos.filter((video) => video.channelId === channel.id).length;
                return (
                  <button className={`channel-tile ${selectedChannelId === channel.id ? 'active' : ''}`} key={channel.id} onClick={() => setSelectedChannelId(channel.id)}>
                    {channel.thumbnail ? <img src={channel.thumbnail} alt="" /> : <span className="channel-avatar">{channel.title.slice(0, 2)}</span>}
                    <strong>{channel.title}</strong>
                    <small>{channel.category || 'Learning'} · {videoCount} videos</small>
                  </button>
                );
              })}
            </div>
          )}
          <div className="video-grid">
            {loadingVideos ? (
              <div className="empty-list state-card">Loading approved channel videos...</div>
            ) : videoLoadError && filteredVideos.length === 0 ? (
              <div className="empty-list state-card error-state">Could not refresh approved channel videos: {videoLoadError}</div>
            ) : filteredVideos.length === 0 ? (
              <div className="empty-list">No videos match this filter yet.</div>
            ) : filteredVideos.map((video) => (
              <article className="video-card" key={video.id}>
                <button className="video-play-button" onClick={() => playVideo(video)}>
                  {video.thumbnail && <img src={video.thumbnail} alt="" />}
                  <strong>{video.title}</strong>
                  <span>{video.channelTitle} · {categoryForVideo(video)}</span>
                </button>
                <div className="video-card-actions">
                  <button className="favorite-video-button" onClick={() => toggleFavorite(video)}>{favoriteVideoIds.has(video.id) ? 'Favorited' : 'Favorite'}</button>
                  {adminUnlocked && <button className="hide-video-button" onClick={() => hideVideo(video)}>Hide</button>}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : mode === 'unlock' ? (
        <section className="unlock-layout">
          <div className="panel unlock-panel">
            <h2>Parent PIN</h2>
            <p>Enter the parent PIN to manage approved channels, discovery, and settings.</p>
            <label>
              PIN
              <input
                autoFocus
                inputMode="numeric"
                type="password"
                value={pinInput}
                onChange={(event) => setPinInput(event.target.value.replace(/\D/g, '').slice(0, 8))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') unlockAdmin();
                }}
                placeholder="4 to 8 digits"
              />
            </label>
            <button className="primary" onClick={unlockAdmin}>Unlock Parent Admin</button>
          </div>
        </section>
      ) : (
        <section className="admin-layout">
          <div className="panel">
            <h2>Manual Approval</h2>
            <p>Paste a UC channel ID, channel URL, or exact @handle. IDs and handles work without an API key; channel-name search needs one.</p>
            <label>
              Channel ID, URL, or @handle
              <input value={channelIdInput} onChange={(event) => setChannelIdInput(event.target.value)} placeholder="UC..., youtube.com/@channel, or @channel" />
            </label>
            <label>
              Display Name
              <input value={channelTitleInput} onChange={(event) => setChannelTitleInput(event.target.value)} placeholder="Channel name" />
            </label>
            <button className="primary" onClick={() => addChannel({ id: channelIdInput, title: channelTitleInput })}>Approve Channel</button>
            <div className="bulk-box">
              <h3>Bulk Add Channels</h3>
              <p>Paste one channel per line. Use `Channel Name | UC...` or `Channel Name | @handle` when you want a custom display name.</p>
              <textarea
                value={bulkChannelInput}
                onChange={(event) => setBulkChannelInput(event.target.value)}
                placeholder={'Bluey Official | @BlueyOfficialChannel\nUCxxxxxxxxxxxxxxxxxxxxxx\nyoutube.com/@SomeKidsChannel'}
                rows={7}
              />
              <button className="primary" onClick={addBulkChannels}>Bulk Approve</button>
            </div>
            <div className="bulk-box">
              <h3>Categories</h3>
              <p>Categories will drive the kid-friendly home screen and filters.</p>
              <div className="search-row">
                <input value={categoryInput} onChange={(event) => setCategoryInput(event.target.value)} placeholder="New category" />
                <button className="primary" onClick={addCategory}>Add</button>
              </div>
              <div className="tag-list">
                {settings.categories.map((category) => (
                  <span className="tag" key={category}>{category}<button onClick={() => removeCategory(category)}>x</button></span>
                ))}
              </div>
            </div>
            <div className="bulk-box approved-video-box">
              <h3>Approve Individual Video</h3>
              <p>Use this for a specific video without approving the whole channel. Paste a YouTube URL or 11-character video ID.</p>
              <label>
                Video URL or ID
                <input value={videoIdInput} onChange={(event) => setVideoIdInput(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
              </label>
              <label>
                Display Title
                <input value={videoTitleInput} onChange={(event) => setVideoTitleInput(event.target.value)} placeholder="Optional, shown in Watch mode" />
              </label>
              <div className="settings-row">
                <label>
                  Channel Name
                  <input value={videoChannelInput} onChange={(event) => setVideoChannelInput(event.target.value)} placeholder="Optional" />
                </label>
                <label>
                  Category
                  <select value={videoCategoryInput} onChange={(event) => setVideoCategoryInput(event.target.value)}>
                    {settings.categories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </label>
              </div>
              <button className="primary" onClick={addApprovedVideo}>Approve Video</button>
            </div>
            <div className="manager-list">
              <h3>Current Approved List ({settings.approvedChannels.length})</h3>
              {settings.approvedChannels.length === 0 ? (
                <p>No approved channels yet.</p>
              ) : settings.approvedChannels.map((channel) => (
                <div className={`manager-row channel-editor ${channel.enabled === false ? 'disabled' : ''}`} key={channel.id}>
                  <div className="channel-editor-main">
                    <div className="channel-editor-heading">
                      <strong>{channel.title}</strong>
                      <label className="inline-toggle">
                        <input
                          type="checkbox"
                          checked={channel.enabled !== false}
                          onChange={(event) => updateApprovedChannel(channel.id, { enabled: event.target.checked })}
                        />
                        Enabled
                      </label>
                    </div>
                    <span>{channel.id}</span>
                    <div className="channel-editor-grid">
                      <label>
                        Category
                        <select
                          value={channel.category || 'Learning'}
                          onChange={(event) => updateApprovedChannel(channel.id, { category: event.target.value })}
                        >
                          {settings.categories.map((category) => <option key={category} value={category}>{category}</option>)}
                        </select>
                      </label>
                      <label>
                        Language
                        <input
                          value={channel.language || 'en'}
                          onChange={(event) => updateApprovedChannel(channel.id, { language: event.target.value || 'en' })}
                        />
                      </label>
                    </div>
                    <label>
                      Parent Notes
                      <input
                        value={channel.notes || ''}
                        onChange={(event) => updateApprovedChannel(channel.id, { notes: event.target.value })}
                        placeholder="Why this channel is approved"
                      />
                    </label>
                    <span>Approved {channel.approvedAt ? new Date(channel.approvedAt).toLocaleDateString() : 'unknown date'}</span>
                  </div>
                  <button onClick={() => removeChannel(channel.id)}>Remove</button>
                </div>
              ))}
            </div>
            <div className="manager-list approved-video-list">
              <h3>Approved Videos ({settings.approvedVideos.length})</h3>
              {settings.approvedVideos.length === 0 ? (
                <p>No individual videos approved yet.</p>
              ) : settings.approvedVideos.map((videoId) => {
                const video = settings.approvedVideoDetails[videoId] || { id: videoId, title: videoId, channelTitle: 'Approved Video' };
                return (
                  <div className="manager-row" key={videoId}>
                    {video.thumbnail && <img className="row-thumbnail" src={video.thumbnail} alt="" />}
                    <div>
                      <strong>{video.title}</strong>
                      <span>{video.channelTitle} · {video.category || 'Learning'} · {videoId}</span>
                    </div>
                    <button onClick={() => removeApprovedVideo(videoId)}>Remove</button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <h2>Discover Mode</h2>
            <p>Discovery is parent-only and searches channel candidates with English relevance and your selected region.</p>
            <div className="settings-row">
              <label>
                Language
                <input value={settings.language} onChange={(event) => saveSettings({ ...settings, language: event.target.value || 'en' })} />
              </label>
              <label>
                Region
                <input value={settings.region} onChange={(event) => saveSettings({ ...settings, region: event.target.value || 'US' })} />
              </label>
            </div>
            <label>
              YouTube Data API Key
              <input type="password" value={settings.youtubeApiKey} onChange={(event) => saveSettings({ ...settings, youtubeApiKey: event.target.value })} placeholder="Optional for discovery" />
            </label>
            <div className="search-row">
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search English kids channels" />
              <button className="primary" disabled={discovering} onClick={runDiscovery}>{discovering ? 'Searching...' : 'Search'}</button>
            </div>
            <div className="discover-results">
              {discovering ? (
                <div className="empty-list state-card">Searching for English channel candidates...</div>
              ) : discoverResults.length === 0 ? (
                <div className="empty-list state-card">No discovery results loaded. Search when you are ready to review new channels.</div>
              ) : discoverResults.map((channel) => (
                <article className={`discover-card ${reviewChannel?.id === channel.id ? 'selected' : ''}`} key={channel.id}>
                  <button className="blacklist-button" title="Hide this channel from discovery" onClick={() => blockChannel(channel)}>X</button>
                  {channel.thumbnail && <img src={channel.thumbnail} alt="" />}
                  <div>
                    <strong>{channel.title}</strong>
                    <p>{channel.description || 'No description.'}</p>
                    <div className="card-actions">
                      <button onClick={() => reviewCandidate(channel)}>Review</button>
                      <button className="quiet-button" onClick={() => blockChannel(channel)}>Blacklist</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {reviewChannel && (
              <div className="review-panel">
                <div className="review-heading">
                  <div>
                    <p className="eyebrow dark">Review Candidate</p>
                    <h3>{reviewChannel.title}</h3>
                  </div>
                  <div className="card-actions">
                    <button className="primary" onClick={() => addChannel(reviewChannel)}>Approve Channel</button>
                    <button className="quiet-button" onClick={() => blockChannel(reviewChannel)}>Blacklist</button>
                  </div>
                </div>
                <p>Recent uploads from the channel feed. Use this to spot duplicate, low-effort, or wrong-language channels before approval.</p>
                <div className="review-video-grid">
                  {reviewLoading ? (
                    <p>Loading recent uploads...</p>
                  ) : reviewVideos.length === 0 ? (
                    <p>No recent uploads found.</p>
                  ) : reviewVideos.map((video) => (
                    <article className="review-video" key={video.id}>
                      {video.thumbnail && <img src={video.thumbnail} alt="" />}
                      <strong>{video.title}</strong>
                      {video.published && <span>{new Date(video.published).toLocaleDateString()}</span>}
                    </article>
                  ))}
                </div>
              </div>
            )}
            <div className="manager-list blacklist-list">
              <h3>Discovery Blacklist</h3>
              {settings.blockedChannels.length === 0 ? (
                <p>No blacklisted discovery channels.</p>
              ) : settings.blockedChannels.map((channelId) => (
                <div className="manager-row" key={channelId}>
                  <span>{channelId}</span>
                  <button onClick={() => unblockChannel(channelId)}>Unblock</button>
                </div>
              ))}
            </div>
            <div className="manager-list hidden-video-list">
              <h3>Hidden Videos ({settings.hiddenVideos.length})</h3>
              {hiddenVideoDetails.length === 0 ? (
                <p>No hidden videos.</p>
              ) : hiddenVideoDetails.map((video) => (
                <div className="manager-row" key={video.id}>
                  {video.thumbnail && <img className="row-thumbnail" src={video.thumbnail} alt="" />}
                  <div>
                    <strong>{video.title}</strong>
                    <span>{video.channelTitle}{video.hiddenAt ? ` · Hidden ${new Date(video.hiddenAt).toLocaleDateString()}` : ''}</span>
                  </div>
                  <button onClick={() => unhideVideo(video.id)}>Unhide</button>
                </div>
              ))}
            </div>
            <div className="manager-list security-list">
              <h3>Parent PIN</h3>
              <p>{settings.pinHash ? 'Admin mode is protected. Change the PIN here if needed.' : 'Set a PIN so children cannot enter Parent Admin.'}</p>
              <label>
                New PIN
                <input
                  inputMode="numeric"
                  type="password"
                  value={newPinInput}
                  onChange={(event) => setNewPinInput(event.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder="4 to 8 digits"
                />
              </label>
              <button className="primary" onClick={setParentPin}>{settings.pinHash ? 'Change PIN' : 'Set PIN'}</button>
            </div>
            <div className="manager-list limits-list">
              <h3>Viewing Limits</h3>
              <p>Simple limits count one minute while a video is selected in Watch mode.</p>
              <label className="inline-toggle limit-toggle">
                <input
                  type="checkbox"
                  checked={settings.viewingLimits.enabled}
                  onChange={(event) => saveSettings({
                    ...settings,
                    viewingLimits: { ...settings.viewingLimits, enabled: event.target.checked },
                  })}
                />
                Enable daily viewing limit
              </label>
              <label>
                Daily Minutes
                <input
                  min="1"
                  max="720"
                  type="number"
                  value={settings.viewingLimits.dailyMinutes}
                  onChange={(event) => saveSettings({
                    ...settings,
                    viewingLimits: { ...settings.viewingLimits, dailyMinutes: Number(event.target.value) || 1 },
                  })}
                />
              </label>
              <label className="inline-toggle limit-toggle">
                <input
                  type="checkbox"
                  checked={settings.viewingLimits.quietHoursEnabled}
                  onChange={(event) => saveSettings({
                    ...settings,
                    viewingLimits: { ...settings.viewingLimits, quietHoursEnabled: event.target.checked },
                  })}
                />
                Enable quiet hours
              </label>
              <div className="settings-row">
                <label>
                  Quiet Start
                  <input
                    type="time"
                    value={settings.viewingLimits.quietStart}
                    onChange={(event) => saveSettings({
                      ...settings,
                      viewingLimits: { ...settings.viewingLimits, quietStart: event.target.value || '20:00' },
                    })}
                  />
                </label>
                <label>
                  Quiet End
                  <input
                    type="time"
                    value={settings.viewingLimits.quietEnd}
                    onChange={(event) => saveSettings({
                      ...settings,
                      viewingLimits: { ...settings.viewingLimits, quietEnd: event.target.value || '07:00' },
                    })}
                  />
                </label>
              </div>
              <div className="manager-row">
                <div>
                  <strong>Used Today</strong>
                  <span>{currentViewingStatus.usedToday} minutes</span>
                </div>
                <button onClick={() => saveSettings({
                  ...settings,
                  usageByDate: { ...settings.usageByDate, [todayKey()]: 0 },
                })}>Reset Today</button>
              </div>
            </div>
            <div className="manager-list backup-list">
              <h3>Backup And Restore</h3>
              <p>Export approved channels, blacklist, categories, and notes. PIN and YouTube API key are not included in exports.</p>
              <div className="card-actions">
                <button className="primary" onClick={exportSettings}>Export Settings</button>
                <button className="quiet-button" onClick={importSettings}>Import Settings</button>
                <button className="quiet-button" disabled={backupLoading} onClick={loadBackups}>{backupLoading ? 'Loading Backups...' : 'Show Backups'}</button>
              </div>
              {backupState === 'empty' && <p>No backup snapshots loaded yet.</p>}
              {backupState === 'has-backups' && (
                <div className="backup-snapshot-list">
                  {backups.map((backup) => (
                    <div className="manager-row" key={backup.fileName}>
                      <div>
                        <strong>{backup.fileName}</strong>
                        <span>{new Date(backup.createdAt).toLocaleString()} · {Math.round(backup.size / 1024)} KB</span>
                      </div>
                      <button onClick={() => restoreBackup(backup.fileName)}>Restore</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="manager-list log-list">
              <h3>Troubleshooting Log</h3>
              <p>Recent feed and API failures are written locally for troubleshooting.</p>
              <button className="primary" disabled={logLoading} onClick={loadAppLog}>{logLoading ? 'Loading Log...' : 'Load Recent Log'}</button>
              {appLog && <pre className="log-output">{appLog}</pre>}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
