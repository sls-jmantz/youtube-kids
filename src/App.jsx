import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const emptySettings = {
  schemaVersion: 5,
  approvedChannels: [],
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
  youtubeApiKey: '',
};

function parseFeed(xmlText, channel) {
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

function normalizeChannelId(input) {
  const trimmed = input.trim();
  const match = trimmed.match(/(UC[a-zA-Z0-9_-]{20,})/);
  return match ? match[1] : trimmed;
}

function parseBulkChannelLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('|').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { id: trimmed, title: '' };
  const firstLooksLikeChannel = /UC[a-zA-Z0-9_-]{20,}|@|youtube\.com|youtu\.be/.test(parts[0]);
  return firstLooksLikeChannel
    ? { id: parts[0], title: parts.slice(1).join(' | ') }
    : { id: parts.slice(1).join(' | '), title: parts[0] };
}

function createApprovedChannel(channel, fallbackTitle = '') {
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

function videoSnapshot(video, dateField) {
  return {
    id: video.id,
    title: video.title,
    channelTitle: video.channelTitle,
    channelId: video.channelId,
    thumbnail: video.thumbnail,
    [dateField]: new Date().toISOString(),
  };
}

function App() {
  const [settings, setSettings] = useState(emptySettings);
  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedChannelId, setSelectedChannelId] = useState('All');
  const [quickFilter, setQuickFilter] = useState('All');
  const [mode, setMode] = useState('watch');
  const [channelIdInput, setChannelIdInput] = useState('');
  const [channelTitleInput, setChannelTitleInput] = useState('');
  const [bulkChannelInput, setBulkChannelInput] = useState('');
  const [categoryInput, setCategoryInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('nursery rhymes');
  const [discoverResults, setDiscoverResults] = useState([]);
  const [reviewChannel, setReviewChannel] = useState(null);
  const [reviewVideos, setReviewVideos] = useState([]);
  const [appLog, setAppLog] = useState('');
  const [backups, setBackups] = useState([]);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [status, setStatus] = useState('Loading settings...');

  useEffect(() => {
    window.appApi.readSettings().then((loaded) => {
      setSettings(loaded);
      setStatus('Ready');
    }).catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadVideos() {
      const enabledChannels = settings.approvedChannels.filter((channel) => channel.enabled !== false);
      if (!enabledChannels.length) {
        setVideos([]);
        setSelectedVideo(null);
        return;
      }
      setStatus('Loading approved channel videos...');
      try {
        const feeds = await Promise.all(enabledChannels.map(async (channel) => {
          const feed = await window.appApi.fetchChannelFeed(channel.id);
          return {
            videos: parseFeed(feed.xmlText, channel),
            fromCache: feed.fromCache,
          };
        }));
        if (cancelled) return;
        const nextVideos = feeds.flatMap((feed) => feed.videos).sort((a, b) => new Date(b.published) - new Date(a.published));
        setVideos(nextVideos);
        setSelectedVideo((current) => current && nextVideos.some((video) => video.id === current.id) ? current : nextVideos[0] || null);
        setStatus(feeds.some((feed) => feed.fromCache) ? 'Ready using cached feeds for one or more channels.' : 'Ready');
      } catch (error) {
        if (!cancelled) setStatus(error.message);
      }
    }
    loadVideos();
    return () => {
      cancelled = true;
    };
  }, [settings.approvedChannels]);

  async function saveSettings(nextSettings) {
    const saved = await window.appApi.writeSettings(nextSettings);
    setSettings(saved);
    return saved;
  }

  function openAdmin() {
    if (!settings.pinHash || adminUnlocked) {
      setMode('admin');
      return;
    }
    setPinInput('');
    setMode('unlock');
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
      const saved = await window.appApi.setPin(newPinInput);
      setSettings(saved);
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
    let title = channel.title?.trim() || channelTitleInput.trim() || id;
    if (!id.startsWith('UC')) {
      setStatus('Resolving channel handle...');
      const resolved = await window.appApi.resolveChannel({ input: channel.id, apiKey: settings.youtubeApiKey });
      if (resolved.needsApiKey) {
        throw new Error('Paste a UC channel ID, or add a YouTube Data API key to resolve @handles and channel names.');
      }
      if (resolved.notFound || !resolved.id) {
        throw new Error('Could not find that channel. Try pasting the channel ID or exact @handle.');
      }
      id = resolved.id;
      title = channel.title?.trim() || channelTitleInput.trim() || resolved.title || id;
    }
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
    if (settings.approvedChannels.some((approved) => approved.id === id)) {
      setStatus('That channel is already approved.');
      return;
    }
    await saveSettings({
      ...settings,
      approvedChannels: [...settings.approvedChannels, createApprovedChannel({ ...channel, id, title })],
      blockedChannels: settings.blockedChannels.filter((blockedId) => blockedId !== id),
    });
    setDiscoverResults((results) => results.filter((result) => result.id !== id));
    if (reviewChannel?.id === id) {
      setReviewChannel(null);
      setReviewVideos([]);
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
    });
    if (selectedCategory === category) setSelectedCategory('All');
    setStatus(`Removed category ${category}.`);
  }

  async function exportSettings() {
    try {
      const result = await window.appApi.exportSettings();
      if (!result.canceled) setStatus(`Settings exported to ${result.filePath}`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function importSettings() {
    try {
      const result = await window.appApi.importSettings();
      if (result.canceled) return;
      setSettings(result.settings);
      setDiscoverResults([]);
      setReviewChannel(null);
      setReviewVideos([]);
      setStatus(`Settings imported from ${result.filePath}`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function loadBackups() {
    try {
      const snapshots = await window.appApi.listBackups();
      setBackups(snapshots);
      setStatus(`Found ${snapshots.length} backup snapshots.`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function restoreBackup(fileName) {
    try {
      const result = await window.appApi.restoreBackup(fileName);
      setSettings(result.settings);
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
    try {
      const logText = await window.appApi.readLog();
      setAppLog(logText || 'No log entries yet.');
      setStatus('Loaded app log.');
    } catch (error) {
      setStatus(error.message);
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
    if (reviewChannel?.id === channel.id) {
      setReviewChannel(null);
      setReviewVideos([]);
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
      const approvedIds = new Set(settings.approvedChannels.map((channel) => channel.id));
      const blockedIds = new Set(settings.blockedChannels);
      const visibleItems = result.items.filter((item) => !approvedIds.has(item.id) && !blockedIds.has(item.id));
      setDiscoverResults(visibleItems);
      setReviewChannel(null);
      setReviewVideos([]);
      setStatus(`Found ${visibleItems.length} new English-region channel candidates.`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function reviewCandidate(channel) {
    setReviewChannel(channel);
    setReviewVideos([]);
    setStatus(`Loading recent uploads for ${channel.title}...`);
    try {
      const recentVideos = await window.appApi.fetchChannelVideos(channel.id);
      setReviewVideos(recentVideos);
      setStatus(`Reviewing ${channel.title}.`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  const approvedIds = new Set(settings.approvedChannels.map((channel) => channel.id));
  const enabledChannels = settings.approvedChannels.filter((channel) => channel.enabled !== false);
  const visibleChannels = selectedCategory === 'All'
    ? enabledChannels
    : enabledChannels.filter((channel) => (channel.category || 'Learning') === selectedCategory);
  const enabledApprovedIds = new Set(enabledChannels.map((channel) => channel.id));
  const hiddenVideoIds = new Set(settings.hiddenVideos);
  const favoriteVideoIds = new Set(settings.favoriteVideos);
  const visibleVideos = videos.filter((video) => !hiddenVideoIds.has(video.id));
  const playableVideo = selectedVideo && enabledApprovedIds.has(selectedVideo.channelId) && !hiddenVideoIds.has(selectedVideo.id) ? selectedVideo : null;
  const categoryByChannelId = new Map(settings.approvedChannels.map((channel) => [channel.id, channel.category || 'Learning']));
  const quickFilteredVideos = visibleVideos.filter((video) => {
    if (quickFilter === 'Favorites') return favoriteVideoIds.has(video.id);
    if (quickFilter === 'Recent') return settings.recentlyWatched.some((item) => item.id === video.id);
    return true;
  });
  const filteredVideos = quickFilteredVideos.filter((video) => (
    (selectedCategory === 'All' || categoryByChannelId.get(video.channelId) === selectedCategory)
    && (selectedChannelId === 'All' || video.channelId === selectedChannelId)
  ));
  const categoryFilteredVideos = quickFilteredVideos.filter((video) => (
    selectedCategory === 'All' || categoryByChannelId.get(video.channelId) === selectedCategory
  ));
  const hiddenVideoDetails = settings.hiddenVideos.map((videoId) => (
    videos.find((video) => video.id === videoId) || settings.hiddenVideoDetails[videoId] || { id: videoId, title: videoId, channelTitle: 'Unknown channel' }
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
          <button className={mode === 'admin' || mode === 'unlock' ? 'active' : ''} onClick={openAdmin}>Parent Admin</button>
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
                src={`https://www.youtube-nocookie.com/embed/${playableVideo.id}?rel=0&modestbranding=1`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : (
              <div className="empty-player">Approve a channel to start watching.</div>
            )}
          </div>
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
            {filteredVideos.length === 0 ? (
              <div className="empty-list">No videos match this filter yet.</div>
            ) : filteredVideos.map((video) => (
              <article className="video-card" key={video.id}>
                <button className="video-play-button" onClick={() => playVideo(video)}>
                  {video.thumbnail && <img src={video.thumbnail} alt="" />}
                  <strong>{video.title}</strong>
                  <span>{video.channelTitle} · {categoryByChannelId.get(video.channelId) || 'Learning'}</span>
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
            <p>Paste a UC channel ID, channel URL, or @handle. Handles need the API key; UC IDs work without one.</p>
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
              <button className="primary" onClick={runDiscovery}>Search</button>
            </div>
            <div className="discover-results">
              {discoverResults.map((channel) => (
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
                  {reviewVideos.length === 0 ? (
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
            <div className="manager-list backup-list">
              <h3>Backup And Restore</h3>
              <p>Export approved channels, blacklist, categories, and notes. PIN and YouTube API key are not included in exports.</p>
              <div className="card-actions">
                <button className="primary" onClick={exportSettings}>Export Settings</button>
                <button className="quiet-button" onClick={importSettings}>Import Settings</button>
                <button className="quiet-button" onClick={loadBackups}>Show Backups</button>
              </div>
              {backups.length > 0 && (
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
              <button className="primary" onClick={loadAppLog}>Load Recent Log</button>
              {appLog && <pre className="log-output">{appLog}</pre>}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
