import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const emptySettings = {
  approvedChannels: [],
  blockedChannels: [],
  language: 'en',
  pinHash: '',
  pinSalt: '',
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

function App() {
  const [settings, setSettings] = useState(emptySettings);
  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [mode, setMode] = useState('watch');
  const [channelIdInput, setChannelIdInput] = useState('');
  const [channelTitleInput, setChannelTitleInput] = useState('');
  const [bulkChannelInput, setBulkChannelInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('nursery rhymes');
  const [discoverResults, setDiscoverResults] = useState([]);
  const [reviewChannel, setReviewChannel] = useState(null);
  const [reviewVideos, setReviewVideos] = useState([]);
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
      if (!settings.approvedChannels.length) {
        setVideos([]);
        setSelectedVideo(null);
        return;
      }
      setStatus('Loading approved channel videos...');
      try {
        const feeds = await Promise.all(settings.approvedChannels.map(async (channel) => {
          const xml = await window.appApi.fetchChannelFeed(channel.id);
          return parseFeed(xml, channel);
        }));
        if (cancelled) return;
        const nextVideos = feeds.flat().sort((a, b) => new Date(b.published) - new Date(a.published));
        setVideos(nextVideos);
        setSelectedVideo((current) => current && nextVideos.some((video) => video.id === current.id) ? current : nextVideos[0] || null);
        setStatus('Ready');
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
      approvedChannels: [...settings.approvedChannels, { id, title }],
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
        nextApprovedChannels.push({ id, title });
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
    await saveSettings({
      ...settings,
      approvedChannels: settings.approvedChannels.filter((channel) => channel.id !== channelId),
    });
    setStatus('Channel removed.');
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
  const playableVideo = selectedVideo && approvedIds.has(selectedVideo.channelId) ? selectedVideo : null;

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
          <div className="video-grid">
            {videos.map((video) => (
              <button className="video-card" key={video.id} onClick={() => setSelectedVideo(video)}>
                {video.thumbnail && <img src={video.thumbnail} alt="" />}
                <strong>{video.title}</strong>
                <span>{video.channelTitle}</span>
              </button>
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
            <div className="manager-list">
              <h3>Current Approved List</h3>
              {settings.approvedChannels.length === 0 ? (
                <p>No approved channels yet.</p>
              ) : settings.approvedChannels.map((channel) => (
                <div className="manager-row" key={channel.id}>
                  <div>
                    <strong>{channel.title}</strong>
                    <span>{channel.id}</span>
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
          </div>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
