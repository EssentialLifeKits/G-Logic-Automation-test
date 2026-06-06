/* ============================================================
   G-Logic Automation — Application Logic (Upgraded + Supabase)
   ============================================================ */

(function () {
  'use strict';

  // ========== SUPABASE HELPERS ==========
  const isSupabaseConfigured = typeof supabase !== 'undefined'
    && typeof SUPABASE_URL !== 'undefined'
    && SUPABASE_URL !== 'YOUR_SUPABASE_PROJECT_URL';

  async function getCurrentUserId() {
    if (!isSupabaseConfigured) return null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.user?.id || null;
    } catch { return null; }
  }

  async function loadPostsFromSupabase() {
    if (!isSupabaseConfigured) return null;
    try {
      const userId = await getCurrentUserId();
      if (!userId) return null;
      const { data, error } = await supabase
        .from('posts')
        .select('*')
        .eq('user_id', userId)
        .order('scheduled_time', { ascending: true });
      if (error) { console.error('Supabase load error:', error); return null; }
      // Map Supabase rows to local format
      return data.map(row => ({
        id: row.id,
        caption: row.caption || '',
        date: row.scheduled_time ? row.scheduled_time.split('T')[0] : '',
        time: row.scheduled_time ? row.scheduled_time.split('T')[1]?.substring(0, 5) || '09:00' : '09:00',
        type: row.post_type || 'post',
        status: row.status || 'pending',
        hashtags: row.hashtags || '',
        image_url: row.image_url || '',
        video_url: row.video_url || '',
        media_type: row.media_type || 'IMAGE',
        publish_error: row.publish_error || '',
        retry_count: row.retry_count || 0,
      }));
    } catch (e) { console.error('Supabase load exception:', e); return null; }
  }

  async function uploadMediaToSupabase(file) {
    if (!isSupabaseConfigured) return null;
    try {
      const userId = await getCurrentUserId();
      if (!userId) return null;
      const inferredExt = file.type?.includes('jpeg') ? 'jpg'
        : file.type?.includes('png') ? 'png'
        : file.type?.includes('mp4') ? 'mp4'
        : file.type?.includes('webm') ? 'webm'
        : file.name?.split('.').pop() || 'bin';
      const ext = String(inferredExt).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
      const fileName = `${userId}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
      const uploadPromise = supabase.storage
        .from('media_uploads')
        .upload(fileName, file, {
          cacheControl: '3600',
          contentType: file.type || 'application/octet-stream',
          upsert: false
        });
      const uploadTimeoutMs = file.type?.startsWith('video/') ? 300000 : 180000;
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Media upload timed out.')), uploadTimeoutMs);
      });
      const { data, error } = await Promise.race([uploadPromise, timeoutPromise]);
      if (error) { console.error('Upload error:', error); return null; }
      // Get public URL
      const { data: urlData } = supabase.storage
        .from('media_uploads')
        .getPublicUrl(data.path);
      return urlData?.publicUrl || null;
    } catch (e) { console.error('Upload exception:', e); return null; }
  }

  async function insertPostToSupabase(postData) {
    if (!isSupabaseConfigured) return null;
    try {
      const userId = await getCurrentUserId();
      if (!userId) throw new Error('You are not signed in. Please sign in again before scheduling.');
      const scheduledTime = `${postData.date}T${postData.time || '09:00'}:00`;
      const { data, error } = await supabase
        .from('posts')
        .insert([{
          user_id: userId,
          caption: postData.caption,
          hashtags: postData.hashtags || '',
          post_type: postData.type || 'post',
          scheduled_time: scheduledTime,
          status: postData.status || 'pending',
          image_url: postData.image_url || '',
          media_type: postData.media_type || 'IMAGE',
          video_url: postData.video_url || '',
        }])
        .select();
      if (error) { console.error('Insert error:', error); throw error; }
      return data?.[0] || null;
    } catch (e) { console.error('Insert exception:', e); throw e; }
  }

  // ========== LOCAL STORAGE HELPERS ==========
  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // ========== POST TYPE CONFIG ==========
  const POST_TYPES = {
    post: { label: 'Post', color: '#FEDA75', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' },
    story: { label: 'Story', color: '#34D399', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>' },
    reel: { label: 'Reel', color: '#DD2A7B', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>' },
    carousel: { label: 'Carousel', color: '#515BD4', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="15" height="18" rx="2"/><path d="M20 7v14a2 2 0 01-2 2H7"/></svg>' },
    live: { label: 'Live', color: '#F58529', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' },
  };

  function normalizeDbMediaType(postType, isVideo) {
    if (postType === 'live') return 'NONE';
    if (postType === 'carousel') return 'CAROUSEL';
    return isVideo ? 'VIDEO' : 'IMAGE';
  }

  function isPublishedPost(post) {
    const status = (post?.status || 'pending').toLowerCase();
    return status === 'published';
  }

  function normalizePostTime(time) {
    const raw = String(time || '09:00').trim();
    if (/\b(am|pm)\b/i.test(raw)) return convertTo24(raw);
    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    return match ? `${String(match[1]).padStart(2, '0')}:${match[2]}` : '09:00';
  }

  function getPostScheduledDate(post) {
    if (!post?.date) return null;
    const scheduled = new Date(`${post.date}T${normalizePostTime(post.time)}:00`);
    return Number.isNaN(scheduled.getTime()) ? null : scheduled;
  }

  function shouldShowPostOnCalendar(post) {
    return !isPublishedPost(post);
  }

  function shouldShowPostInUpcoming(post) {
    return !isPublishedPost(post);
  }

  // ========== STATE ==========
  const now = new Date();
  const state = {
    currentPage: 'dashboard',
    currentView: 'month',
    currentDate: new Date(now.getFullYear(), now.getMonth(), 1),
    today: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    selectedDate: null,
    posts: loadJSON('gramlogic_posts', []),
    nextId: loadJSON('gramlogic_nextId', 1),
    analytics: loadJSON('gramlogic_analytics', {
      reach: 0,
      reachChange: '0%',
      engagement: 0,
      engagementChange: '0%',
      followers: 0,
      followersChange: '0',
      postsCount: 0,
      postsCountChange: '0',
    }),
  };

  function savePosts() {
    saveJSON('gramlogic_posts', state.posts);
    saveJSON('gramlogic_nextId', state.nextId);
  }
  function saveAnalytics() {
    saveJSON('gramlogic_analytics', state.analytics);
  }

  // ========== BEST TIMES DATA ==========
  const BEST_TIMES = [
    { time: '9:00 AM', day: 'Weekdays', engagement: '+34%', desc: 'Morning commute peak' },
    { time: '12:30 PM', day: 'Tue & Thu', engagement: '+28%', desc: 'Lunch break activity' },
    { time: '7:00 PM', day: 'Mon–Fri', engagement: '+22%', desc: 'Evening browsing window' },
  ];

  const HOW_TO_STORAGE_KEY = 'glogic_howto_video_v1';
  const HOW_TO_VIDEO_DEFAULTS = {
    title: 'How To Use G-Logic',
    description: 'Watch this short walkthrough to get the most out of G-Logic Automation.',
    youtubeUrl: '',
    downloadUrl: '',
  };
  let howToVideoConfigCache = null;

  function getHowToVideoConfig() {
    if (howToVideoConfigCache) return howToVideoConfigCache;
    try {
      const saved = JSON.parse(localStorage.getItem(HOW_TO_STORAGE_KEY) || 'null');
      howToVideoConfigCache = { ...HOW_TO_VIDEO_DEFAULTS, ...(saved || {}) };
    } catch (_) {
      howToVideoConfigCache = { ...HOW_TO_VIDEO_DEFAULTS };
    }
    return howToVideoConfigCache;
  }

  async function loadHowToVideoConfig() {
    try {
      const response = await fetch('/api/howto-settings', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load How To settings.');
      const localConfig = getHowToVideoConfig();
      const remoteConfig = { ...HOW_TO_VIDEO_DEFAULTS, ...(payload.settings || {}) };
      const hasLocalVideo = Boolean(localConfig.youtubeUrl || localConfig.downloadUrl);
      const hasRemoteVideo = Boolean(remoteConfig.youtubeUrl || remoteConfig.downloadUrl);
      howToVideoConfigCache = hasLocalVideo && !hasRemoteVideo ? localConfig : remoteConfig;
      localStorage.setItem(HOW_TO_STORAGE_KEY, JSON.stringify(howToVideoConfigCache));
    } catch (_) {
      howToVideoConfigCache = getHowToVideoConfig();
    }
    return howToVideoConfigCache;
  }

  // ========== DOM ELEMENTS ==========
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    sidebar: $('#sidebar'),
    sidebarOverlay: $('#sidebarOverlay'),
    hamburgerBtn: $('#hamburgerBtn'),
    navItems: $$('.nav-item'),
    pages: $$('.page'),
    calendarGrid: $('#calendarGrid'),
    calendarHeader: $('#calendarHeader'),
    calendarSubtitle: $('#calendarSubtitle'),
    prevMonthBtn: $('#prevMonthBtn'),
    nextMonthBtn: $('#nextMonthBtn'),
    viewMonthBtn: $('#viewMonthBtn'),
    viewWeekBtn: $('#viewWeekBtn'),
    newPostBtn: $('#newPostBtn'),
    dashboardNewPostBtn: $('#dashboardNewPostBtn'),
    dashboardOpenCalendarBtn: $('#dashboardOpenCalendarBtn'),
    dashboardOpenActionsBtn: $('#dashboardOpenActionsBtn'),
    dashboardTodayCalendarBtn: $('#dashboardTodayCalendarBtn'),
    dashboardQueueActionsBtn: $('#dashboardQueueActionsBtn'),
    dashboardConnectIgBtn: $('#dashboardConnectIgBtn'),
    dashboardStudioTextBtn: $('#dashboardStudioTextBtn'),
    dashboardStudioEditorBtn: $('#dashboardStudioEditorBtn'),
    dashboardStudioAudioBtn: $('#dashboardStudioAudioBtn'),
    dashboardHowToBtn: $('#dashboardHowToBtn'),
    howToOverlay: $('#howToOverlay'),
    howToCloseBtn: $('#howToCloseBtn'),
    howToFullscreenBtn: $('#howToFullscreenBtn'),
    howToIframe: $('#howToIframe'),
    howToVideoFrame: $('#howToVideoFrame'),
    howToDownloadBtn: $('#howToDownloadBtn'),
    howToEmptyState: $('#howToEmptyState'),
    howToTitle: $('#howToTitle'),
    howToDescription: $('#howToDescription'),
    dashTodayCount: $('#dashTodayCount'),
    dashTodayMeta: $('#dashTodayMeta'),
    dashUpcomingCount: $('#dashUpcomingCount'),
    dashNextPostMeta: $('#dashNextPostMeta'),
    dashMonthCount: $('#dashMonthCount'),
    dashTypeBreakdown: $('#dashTypeBreakdown'),
    dashAttentionCount: $('#dashAttentionCount'),
    dashAttentionMeta: $('#dashAttentionMeta'),
    dashboardHeroTitle: $('#dashboardHeroTitle'),
    dashboardHeroMeta: $('#dashboardHeroMeta'),
    dashboardTodayList: $('#dashboardTodayList'),
    dashboardQueueList: $('#dashboardQueueList'),
    dashboardActivityList: $('#dashboardActivityList'),
    dashboardIgStatus: $('#dashboardIgStatus'),
    dashboardIgHandle: $('#dashboardIgHandle'),
    dashboardLastPublish: $('#dashboardLastPublish'),
    mobileTodayBtn: $('#mobileTodayBtn'),
    bestTimesList: $('#bestTimesList'),
    upcomingList: $('#upcomingList'),
    modalOverlay: $('#modalOverlay'),
    modalClose: $('#modalClose'),
    modalTitle: $('#modalTitle'),
    uploadZone: $('#uploadZone'),
    fileInput: $('#fileInput'),
    uploadPreview: $('#uploadPreview'),
    addTextBtn: $('#addTextBtn'),
    editMediaBtn: $('#editMediaBtn'),
    returnToEditorBtn: $('#returnToEditorBtn'),
    captureThumbBtn: $('#captureThumbBtn'),
    capturedThumbPreview: $('#capturedThumbPreview'),
    removeMediaBtn: $('#removeMediaBtn'),
    uploadPlaceholder: $('#uploadPlaceholder'),
    captionInput: $('#captionInput'),
    captionCount: $('#captionCount'),
    dateInput: $('#dateInput'),
    timeInput: $('#timeInput'),
    hashtagInput: $('#hashtagInput'),
    typeButtons: null, // set after DOM ready
    schedulePostBtn: $('#schedulePostBtn'),
    saveDraftBtn: $('#saveDraftBtn'),
    modalTimesList: $('#modalTimesList'),
    toast: $('#toast'),
    toastMessage: $('#toastMessage'),
    engagementCanvas: $('#engagementCanvas'),
    topPostsList: $('#topPostsList'),
    // analytics stat cards
    statReach: $('#statReach'),
    statEngagement: $('#statEngagement'),
    statFollowers: $('#statFollowers'),
    statPosts: $('#statPosts'),
    // copy buttons
    copyCaptionBtn: $('#copyCaptionBtn'),
    copyHashtagBtn: $('#copyHashtagBtn'),
    // NEW: Actions Page elements
    actionsPageBtn: $('#actionsPageBtn'),
    actionsPageOverlay: $('#actionsPageOverlay'),
    actionsPageClose: $('#actionsPageClose'),
    actionsPageBody: $('#actionsPageBody'),
    actionsMetricsBar: $('#actionsMetricsBar'),
    // NEW: Today day name
    todayDayName: $('#todayDayName'),
    // NEW: Upcoming month jump
    upcomingMonthJump: $('#upcomingMonthJump'),
  };

  // ========== NAVIGATION ==========
  function navigateTo(page) {
    state.currentPage = page;
    els.navItems.forEach(item => item.classList.toggle('active', item.dataset.page === page));
    els.pages.forEach(p => {
      const isTarget = p.id === 'page' + capitalize(page);
      p.classList.toggle('active', isTarget);
    });
    closeSidebar();
    if (page === 'analytics') {
      renderAnalyticsCards();
      drawChart();
    }
    if (page === 'dashboard') renderDashboard();
  }

  els.navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(item.dataset.page);
    });
  });

  // ========== SIDEBAR MOBILE ==========
  function openSidebar() {
    els.sidebar.classList.add('open');
    els.sidebarOverlay.classList.add('active');
    els.hamburgerBtn.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    els.sidebar.classList.remove('open');
    els.sidebarOverlay.classList.remove('active');
    els.hamburgerBtn.classList.remove('active');
    document.body.style.overflow = '';
  }

  els.hamburgerBtn.addEventListener('click', () => {
    els.sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  els.sidebarOverlay.addEventListener('click', closeSidebar);

  // ========== CALENDAR ==========
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function renderCalendarHeader() {
    els.calendarHeader.innerHTML = DAY_NAMES.map(d =>
      `<div class="cal-day-name">${d}</div>`
    ).join('');
  }

  function renderCalendar() {
    const year = state.currentDate.getFullYear();
    const month = state.currentDate.getMonth();
    els.calendarSubtitle.textContent = `${MONTH_NAMES[month]} ${year}`;

    if (state.currentView === 'month') {
      renderMonthView(year, month);
    } else {
      renderWeekView();
    }
    renderDashboard();
  }

  function renderMonthView(year, month) {
    els.calendarGrid.classList.remove('week-view');
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();

    let cells = [];
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = daysInPrev - i;
      const dateStr = formatDate(year, month - 1, day);
      cells.push(createDayCell(day, dateStr, true));
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = formatDate(year, month, d);
      const isToday = dateStr === formatDate(state.today.getFullYear(), state.today.getMonth(), state.today.getDate());
      cells.push(createDayCell(d, dateStr, false, isToday));
    }
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const dateStr = formatDate(year, month + 1, d);
      cells.push(createDayCell(d, dateStr, true));
    }

    els.calendarGrid.innerHTML = cells.join('');
    attachCalendarHandlers();
  }

  function renderWeekView() {
    els.calendarGrid.classList.add('week-view');
    const today = state.today;
    const dayOfWeek = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek);

    let cells = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const dateStr = formatDate(d.getFullYear(), d.getMonth(), d.getDate());
      const isToday = dateStr === formatDate(today.getFullYear(), today.getMonth(), today.getDate());
      cells.push(createDayCell(d.getDate(), dateStr, false, isToday));
    }

    els.calendarGrid.innerHTML = cells.join('');
    attachCalendarHandlers();
  }

  function createDayCell(day, dateStr, isOtherMonth, isToday = false) {
    const posts = getPostsByDate(dateStr);
    const maxVisible = 2;

    // Color-coded horizontal bars — one segment for every scheduled item.
    let barsHtml = '';
    if (posts.length > 0) {
      const barItems = posts.slice().sort((a, b) => (a.time || '').localeCompare(b.time || '')).map(post => {
        const typeConf = POST_TYPES[post.type] || POST_TYPES.post;
        const label = `${formatTime12(post.time)} ${typeConf.label}`;
        return `<div class="cal-bar cal-bar-${post.type}" data-post-id="${post.id}" style="background:${typeConf.color};" title="${escapeHtml(label)}"></div>`;
      }).join('');
      barsHtml = `<div class="cal-post-bars">${barItems}</div>`;
    }

    // Post entries (max 2 visible with +X more)
    const visibleEntries = posts.slice(0, maxVisible);
    let entriesHtml = visibleEntries.map(p => {
      const typeConf = POST_TYPES[p.type] || POST_TYPES.post;
      return `<div class="cal-post cal-post-type-${p.type}" data-post-id="${p.id}" title="${escapeHtml(p.caption)}">${formatTime12(p.time)} ${typeConf.label}</div>`;
    }).join('');

    if (posts.length > maxVisible) {
      const extra = posts.length - maxVisible;
      entriesHtml += `<div class="cal-post cal-post-more" data-date="${dateStr}">+${extra} more</div>`;
    }

    return `<div class="cal-day${isOtherMonth ? ' other-month' : ''}${isToday ? ' today' : ''}" data-date="${dateStr}">
      <div class="cal-date">${isToday ? `<span>${day}</span>` : day}</div>
      ${barsHtml}
      <div class="cal-posts">${entriesHtml}</div>
    </div>`;
  }

  function attachCalendarHandlers() {
    els.calendarGrid.querySelectorAll('.cal-day').forEach(cell => {
      cell.addEventListener('click', (e) => {
        // Don't open scheduler if clicking the "+X more" toggle
        if (e.target.classList.contains('cal-post-more')) {
          e.stopPropagation();
          expandMorePosts(e.target, cell.dataset.date);
          return;
        }
        // If clicking a specific post entry, open edit for that post
        const postEl = e.target.closest('.cal-post[data-post-id]');
        if (postEl) {
          e.stopPropagation();
          openEditModal(postEl.dataset.postId);
          return;
        }
        
        // If clicking the empty space of a day, always open new scheduler
        openScheduler(cell.dataset.date);
      });
    });
  }

  function expandMorePosts(el, dateStr) {
    const posts = getPostsByDate(dateStr);
    const cell = el.closest('.cal-day');
    const postsContainer = cell.querySelector('.cal-posts');
    // Replace entries with all posts — include data-post-id so clicks open edit
    postsContainer.innerHTML = posts.map(p => {
      const typeConf = POST_TYPES[p.type] || POST_TYPES.post;
      return `<div class="cal-post cal-post-type-${p.type}" data-post-id="${p.id}" title="${escapeHtml(p.caption)}">${formatTime12(p.time)} ${typeConf.label}</div>`;
    }).join('');
  }

  // View toggle
  function setView(view) {
    state.currentView = view;
    els.viewMonthBtn.classList.toggle('active', view === 'month');
    els.viewWeekBtn.classList.toggle('active', view === 'week');
    renderCalendar();
  }

  els.viewMonthBtn.addEventListener('click', () => setView('month'));
  els.viewWeekBtn.addEventListener('click', () => setView('week'));

  // Month navigation
  els.prevMonthBtn.addEventListener('click', () => {
    state.currentDate.setMonth(state.currentDate.getMonth() - 1);
    renderCalendar();
  });
  els.nextMonthBtn.addEventListener('click', () => {
    state.currentDate.setMonth(state.currentDate.getMonth() + 1);
    renderCalendar();
  });
  els.mobileTodayBtn.addEventListener('click', () => {
    state.currentDate = new Date(state.today.getFullYear(), state.today.getMonth(), 1);
    setView('month');
    renderCalendar();
  });

  // ========== BEST TIMES WIDGET ==========
  function renderBestTimes() {
    els.bestTimesList.innerHTML = BEST_TIMES.map((bt, i) => `
      <div class="best-time-item" data-time="${bt.time}">
        <div class="best-time-rank rank-${i + 1}">#${i + 1}</div>
        <div class="best-time-info">
          <div class="best-time-label">${bt.time} · ${bt.day}</div>
          <div class="best-time-desc">${bt.desc}</div>
        </div>
        <div class="best-time-engagement">${bt.engagement}</div>
      </div>
    `).join('');

    els.bestTimesList.querySelectorAll('.best-time-item').forEach(item => {
      item.addEventListener('click', () => {
        const todayStr = formatDate(state.today.getFullYear(), state.today.getMonth(), state.today.getDate());
        openScheduler(todayStr, item.dataset.time);
      });
    });
  }

  // ========== DASHBOARD ==========
  function isActiveScheduledPost(post) {
    const status = (post?.status || 'pending').toLowerCase();
    return ['pending', 'active', 'scheduled', 'failed', 'permanently_failed'].includes(status);
  }

  function getSortedActivePosts() {
    return state.posts
      .filter(p => shouldShowPostInUpcoming(p) && isActiveScheduledPost(p))
      .sort((a, b) => (getPostScheduledDate(a)?.getTime() || 0) - (getPostScheduledDate(b)?.getTime() || 0));
  }

  function getTodayDateString() {
    return formatDate(state.today.getFullYear(), state.today.getMonth(), state.today.getDate());
  }

  function renderDashboardPostItem(post, compact = false) {
    const typeConf = POST_TYPES[post.type] || POST_TYPES.post;
    const statusStr = getStatusClass(post.status);
    const statusLabel = getStatusLabel(post.status);
    const thumbContent = post.image_url
      ? `<img src="${post.image_url}" alt="" loading="lazy">`
      : typeConf.icon;
    return `
      <button class="dashboard-feed-item" data-post-id="${post.id}" type="button">
        <span class="dashboard-feed-thumb" style="border-left-color:${typeConf.color};">${thumbContent}</span>
        <span class="dashboard-feed-copy">
          <strong>${escapeHtml(post.caption || 'Untitled')}</strong>
          <small>${compact ? '' : `${formatDisplayDate(post.date)} · `}${formatTime12(post.time)} · ${typeConf.label}</small>
        </span>
        <span class="upcoming-status status-${statusStr}">${statusLabel}</span>
      </button>`;
  }

  function attachDashboardPostHandlers(root) {
    if (!root) return;
    root.querySelectorAll('.dashboard-feed-item[data-post-id]').forEach(item => {
      item.addEventListener('click', () => openEditModal(item.dataset.postId));
    });
  }

  function renderDashboard() {
    if (!els.dashTodayCount) return;
    const todayStr = getTodayDateString();
    const activePosts = getSortedActivePosts();
    const todayPosts = activePosts.filter(p => p.date === todayStr);
    const month = state.today.getMonth();
    const year = state.today.getFullYear();
    const monthPosts = state.posts.filter(p => {
      if (!p.date || isPublishedPost(p)) return false;
      const d = new Date(p.date + 'T00:00:00');
      return d.getMonth() === month && d.getFullYear() === year;
    });
    const failedPosts = state.posts.filter(p => ['failed', 'permanently_failed'].includes((p.status || '').toLowerCase()));
    const draftPosts = state.posts.filter(p => (p.status || '').toLowerCase() === 'draft');
    const nextPost = activePosts[0];
    const publishedPosts = state.posts
      .filter(isPublishedPost)
      .sort((a, b) => (getPostScheduledDate(b)?.getTime() || 0) - (getPostScheduledDate(a)?.getTime() || 0));
    const typeCounts = {
      post: monthPosts.filter(p => p.type === 'post').length,
      reel: monthPosts.filter(p => p.type === 'reel').length,
      story: monthPosts.filter(p => p.type === 'story').length,
    };

    els.dashTodayCount.textContent = todayPosts.length;
    els.dashTodayMeta.textContent = todayPosts.length === 1 ? '1 post today' : `${todayPosts.length} posts today`;
    els.dashUpcomingCount.textContent = activePosts.length;
    els.dashNextPostMeta.textContent = nextPost
      ? `Next ${formatDisplayDate(nextPost.date)} at ${formatTime12(nextPost.time)}`
      : 'Nothing queued';
    els.dashMonthCount.textContent = monthPosts.length;
    els.dashTypeBreakdown.textContent = `Post ${typeCounts.post} · Reel ${typeCounts.reel} · Story ${typeCounts.story}`;
    els.dashAttentionCount.textContent = failedPosts.length + draftPosts.length;
    els.dashAttentionMeta.textContent = failedPosts.length
      ? `${failedPosts.length} failed item${failedPosts.length === 1 ? '' : 's'}`
      : draftPosts.length
        ? `${draftPosts.length} draft${draftPosts.length === 1 ? '' : 's'}`
        : 'All clear';

    if (els.dashboardHeroTitle) {
      els.dashboardHeroTitle.textContent = todayPosts.length
        ? `${todayPosts.length} scheduled for today`
        : nextPost
          ? 'Queue is ready'
          : 'Ready for today';
    }
    if (els.dashboardHeroMeta) {
      els.dashboardHeroMeta.textContent = nextPost
        ? `Next: ${formatDisplayDate(nextPost.date)} at ${formatTime12(nextPost.time)} · ${(POST_TYPES[nextPost.type] || POST_TYPES.post).label}`
        : 'No upcoming posts queued.';
    }

    if (els.dashboardTodayList) {
      els.dashboardTodayList.innerHTML = todayPosts.length
        ? todayPosts.slice(0, 4).map(p => renderDashboardPostItem(p, true)).join('')
        : '<p class="dashboard-empty">No posts scheduled today.</p>';
      attachDashboardPostHandlers(els.dashboardTodayList);
    }

    if (els.dashboardQueueList) {
      els.dashboardQueueList.innerHTML = activePosts.length
        ? activePosts.slice(0, 6).map(p => renderDashboardPostItem(p)).join('')
        : '<p class="dashboard-empty">No upcoming posts queued.</p>';
      attachDashboardPostHandlers(els.dashboardQueueList);
    }

    if (els.dashboardActivityList) {
      const activity = state.posts
        .slice()
        .sort((a, b) => (getPostScheduledDate(b)?.getTime() || 0) - (getPostScheduledDate(a)?.getTime() || 0))
        .slice(0, 6);
      els.dashboardActivityList.innerHTML = activity.length
        ? activity.map(p => {
            const typeConf = POST_TYPES[p.type] || POST_TYPES.post;
            return `<button class="dashboard-activity-item" data-post-id="${p.id}" type="button">
              <span class="dashboard-activity-dot" style="background:${typeConf.color};"></span>
              <span><strong>${typeConf.label}</strong><small>${formatDisplayDate(p.date)} · ${formatTime12(p.time)} · ${getStatusLabel(p.status)}</small></span>
            </button>`;
          }).join('')
        : '<p class="dashboard-empty">No recent activity yet.</p>';
      els.dashboardActivityList.querySelectorAll('.dashboard-activity-item[data-post-id]').forEach(item => {
        item.addEventListener('click', () => openEditModal(item.dataset.postId));
      });
    }

    const igButton = document.getElementById('connectInstagramBtn');
    const igText = document.getElementById('igStatusText')?.textContent?.trim() || 'Connect Instagram';
    const connected = !!igButton?.classList.contains('connected');
    const expired = !!igButton?.classList.contains('expired');
    if (els.dashboardIgStatus) {
      els.dashboardIgStatus.textContent = expired ? 'Reconnect' : connected ? 'Connected' : 'Not Connected';
      els.dashboardIgStatus.classList.toggle('connected', connected && !expired);
      els.dashboardIgStatus.classList.toggle('expired', expired);
    }
    if (els.dashboardIgHandle) els.dashboardIgHandle.textContent = igText;
    if (els.dashboardLastPublish) {
      els.dashboardLastPublish.textContent = publishedPosts[0]
        ? `Last published ${formatDisplayDate(publishedPosts[0].date)} at ${formatTime12(publishedPosts[0].time)}`
        : 'Last publish unavailable';
    }
  }

  function initDashboardActions() {
    els.dashboardNewPostBtn?.addEventListener('click', () => openScheduler(getTodayDateString()));
    els.dashboardOpenCalendarBtn?.addEventListener('click', () => navigateTo('calendar'));
    els.dashboardTodayCalendarBtn?.addEventListener('click', () => navigateTo('calendar'));
    els.dashboardOpenActionsBtn?.addEventListener('click', openActionsPage);
    els.dashboardQueueActionsBtn?.addEventListener('click', openActionsPage);
    els.dashboardConnectIgBtn?.addEventListener('click', () => document.getElementById('connectInstagramBtn')?.click());
    els.dashboardStudioTextBtn?.addEventListener('click', () => openScheduler(getTodayDateString()));
    els.dashboardStudioEditorBtn?.addEventListener('click', () => {
      openScheduler(getTodayDateString());
      showToast('Media editor workspace is next in the build.');
    });
    els.dashboardStudioAudioBtn?.addEventListener('click', () => {
      openScheduler(getTodayDateString());
      showToast('Audio upload workspace is next in the build.');
    });
    const igButton = document.getElementById('connectInstagramBtn');
    const igText = document.getElementById('igStatusText');
    if (igButton && window.MutationObserver) {
      const observer = new MutationObserver(renderDashboard);
      observer.observe(igButton, { attributes: true, attributeFilter: ['class'] });
      if (igText) observer.observe(igText, { childList: true, characterData: true, subtree: true });
    }
  }

  function getYouTubeVideoId(url) {
    if (!url) return null;
    return url.match(/youtu\.be\/([^?&#]+)/)?.[1]
      || url.match(/[?&]v=([^&#]+)/)?.[1]
      || url.match(/\/embed\/([^?&#]+)/)?.[1]
      || null;
  }

  function getYouTubeEmbedUrl(url) {
    const id = getYouTubeVideoId(url);
    return id
      ? `https://www.youtube.com/embed/${id}?rel=0&controls=1&playsinline=1&fs=1&cc_load_policy=0&modestbranding=1`
      : url;
  }

  function getGoogleDriveFileId(url) {
    if (!url) return null;
    return url.match(/\/file\/d\/([^/?#]+)/)?.[1] || url.match(/[?&]id=([^&#]+)/)?.[1] || null;
  }

  function getGoogleDriveDownloadUrl(url) {
    if (!url || !url.includes('drive.google.com')) return url || '';
    const id = getGoogleDriveFileId(url);
    return id ? `https://drive.google.com/file/d/${id}/view?usp=sharing` : url;
  }

  function setHowToPlayback(shouldLoad) {
    if (!els.howToIframe) return;
    const config = getHowToVideoConfig();
    const embedUrl = config.youtubeUrl ? getYouTubeEmbedUrl(config.youtubeUrl) : '';
    els.howToIframe.src = shouldLoad && embedUrl ? embedUrl : 'about:blank';
    els.howToIframe.hidden = !shouldLoad || !embedUrl;
    if (els.howToEmptyState) {
      els.howToEmptyState.hidden = !!embedUrl;
    }
  }

  async function openHowToVideo() {
    if (!els.howToOverlay) return;
    let config = getHowToVideoConfig();
    if (els.howToTitle) els.howToTitle.textContent = config.title;
    if (els.howToDescription) els.howToDescription.textContent = config.description;
    els.howToOverlay.classList.add('active');
    els.howToOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('howto-open');
    config = await loadHowToVideoConfig();
    if (els.howToTitle) els.howToTitle.textContent = config.title;
    if (els.howToDescription) els.howToDescription.textContent = config.description;
    setHowToPlayback(true);
  }

  function closeHowToVideo() {
    if (!els.howToOverlay) return;
    setHowToPlayback(false);
    els.howToOverlay.classList.remove('active');
    els.howToOverlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('howto-open');
  }

  function openHowToFullscreen() {
    const frame = els.howToVideoFrame;
    if (!frame) return;
    if (frame.requestFullscreen) frame.requestFullscreen();
    else if (frame.webkitRequestFullscreen) frame.webkitRequestFullscreen();
  }

  function downloadHowToVideo() {
    const config = getHowToVideoConfig();
    const targetUrl = config.downloadUrl || config.youtubeUrl;
    const downloadUrl = getGoogleDriveDownloadUrl(targetUrl);
    if (!downloadUrl) {
      showToast('How To download link coming soon.');
      return;
    }
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
  }

  function initHowToVideo() {
    els.dashboardHowToBtn?.addEventListener('click', () => { openHowToVideo(); });
    els.howToCloseBtn?.addEventListener('click', closeHowToVideo);
    els.howToFullscreenBtn?.addEventListener('click', openHowToFullscreen);
    els.howToDownloadBtn?.addEventListener('click', downloadHowToVideo);
    els.howToOverlay?.addEventListener('click', (e) => {
      if (e.target === els.howToOverlay) closeHowToVideo();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.howToOverlay?.classList.contains('active')) {
        closeHowToVideo();
      }
    });
    window.addEventListener('storage', (event) => {
      if (event.key !== HOW_TO_STORAGE_KEY || !els.howToOverlay?.classList.contains('active')) return;
      const config = getHowToVideoConfig();
      if (els.howToTitle) els.howToTitle.textContent = config.title;
      if (els.howToDescription) els.howToDescription.textContent = config.description;
      setHowToPlayback(true);
    });
  }

  function renderModalBestTimes() {
    els.modalTimesList.innerHTML = BEST_TIMES.map(bt =>
      `<button class="modal-time-chip" data-time="${bt.time}" type="button">${bt.time} · ${bt.engagement}</button>`
    ).join('');

    els.modalTimesList.querySelectorAll('.modal-time-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const time24 = convertTo24(chip.dataset.time);
        els.timeInput.value = time24;
        validateForm();
      });
    });
  }

  // ========== UPCOMING POSTS WIDGET ==========
  function renderUpcoming() {
    const upcoming = state.posts
      .filter(shouldShowPostInUpcoming)
      .sort((a, b) => (getPostScheduledDate(a)?.getTime() || 0) - (getPostScheduledDate(b)?.getTime() || 0));

    if (upcoming.length === 0) {
      els.upcomingList.innerHTML = `<p style="text-align:center;color:var(--text-tertiary);font-size:0.82rem;padding:20px;">No upcoming posts. Click a date to schedule!</p>`;
      populateMonthJump([]);
      return;
    }

    // Group by month
    const groups = {};
    upcoming.forEach(p => {
      const d = new Date(p.date + 'T00:00:00');
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
      if (!groups[monthKey]) groups[monthKey] = { label: monthLabel, posts: [] };
      groups[monthKey].posts.push(p);
    });

    let html = '';
    const monthKeys = Object.keys(groups).sort();
    monthKeys.forEach(key => {
      const group = groups[key];
      html += `<div class="upcoming-month-group-header" data-month="${key}">${group.label}</div>`;
      group.posts.forEach(p => {
        const typeConf = POST_TYPES[p.type] || POST_TYPES.post;
        const thumbContent = p.image_url
          ? `<img src="${p.image_url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">`
          : typeConf.icon;
        const statusStr = getStatusClass(p.status);
        const statusLabel = getStatusLabel(p.status);
        html += `
        <div class="upcoming-item" data-post-id="${p.id}">
          <button class="item-delete-btn" data-delete-id="${p.id}" title="Delete post">×</button>
          <div class="upcoming-thumb" style="border-left: 3px solid ${typeConf.color};">
            ${thumbContent}
          </div>
          <div class="upcoming-info">
            <div class="upcoming-caption">${escapeHtml(p.caption)}</div>
            <div class="upcoming-meta">
              <span>${formatDisplayDate(p.date)}</span>
              <span>·</span>
              <span>${formatTime12(p.time)}</span>
              <span class="upcoming-type-badge" style="background:${typeConf.color}22;color:${typeConf.color};">${typeConf.label}</span>
            </div>
          </div>
          <span class="upcoming-status status-${statusStr}">${statusLabel}</span>
        </div>`;
      });
    });

    els.upcomingList.innerHTML = html;
    populateMonthJump(monthKeys.map(k => ({ key: k, label: groups[k].label })));

    // Attach click handlers for editing
    els.upcomingList.querySelectorAll('.upcoming-item[data-post-id]').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.item-delete-btn')) return;
        openEditModal(item.dataset.postId);
      });
    });

    // Delete button handlers
    els.upcomingList.querySelectorAll('.item-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Delete this post?')) {
          deletePost(btn.dataset.deleteId);
          renderCalendar();
          renderUpcoming();
          renderActionsPage();
          renderTopPosts();
          showToast('Post deleted.');
        }
      });
    });
  }

  // Populate month jump dropdown
  function populateMonthJump(months) {
    if (!els.upcomingMonthJump) return;
    els.upcomingMonthJump.innerHTML = '<option value="">All Months</option>';
    months.forEach(m => {
      els.upcomingMonthJump.innerHTML += `<option value="${m.key}">${m.label}</option>`;
    });
  }

  // Month jump handler
  if (els.upcomingMonthJump) {
    els.upcomingMonthJump.addEventListener('change', () => {
      const val = els.upcomingMonthJump.value;
      if (!val) {
        els.upcomingList.scrollTop = 0;
        return;
      }
      const header = els.upcomingList.querySelector(`.upcoming-month-group-header[data-month="${val}"]`);
      if (header) {
        header.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  // ========== TEXT OVERLAY EDITOR (lightweight rebuild) ==========
  // Goals: zero lag, instant text drag, reliable video play/pause/stop,
  // text element shown + trimmable on the timeline. No filmstrip, no preset
  // gallery, no continuous repaint loop, no heavy CSS effects.

  const TOE_FONTS = {
    classic:    "'Playfair Display', Georgia, serif",
    modern:     "'Montserrat', 'Helvetica Neue', sans-serif",
    strong:     "'Anton', Impact, sans-serif",
    neon:       "'Bebas Neue', Impact, sans-serif",
    type:       "'Special Elite', 'Courier New', monospace",
  };

  let toeItems = [];          // {id,text,font,color,size,align,bg,xPct,yPct,start,end}
  let toeActiveId = null;
  let toeFont = 'classic';
  let toeColor = '#ffffff';
  let toeSize = 40;
  let toeAlign = 'center';
  let toeBg = 'none';         // none | dark | solid
  let toeMediaEl = null;      // <img> or <video> in the stage
  let toeIsVideo = false;
  let toeSourceFile = null;   // original (un-burned) file for re-editing

  const toeOverlay   = document.getElementById('toeOverlay');
  const toeStage     = document.getElementById('toeStage');
  const toeTextLayer = document.getElementById('toeTextLayer');
  const toeProcessing = document.getElementById('toeProcessing');
  const toeProcLabel  = document.getElementById('toeProcessingLabel');
  const toeVideoBar  = document.getElementById('toeVideoBar');
  const toePlayBtn   = document.getElementById('toePlayBtn');
  const toeTimeLabel = document.getElementById('toeTimeLabel');
  const toeSeek      = document.getElementById('toeSeek');
  const toeTextTrack = document.getElementById('toeTextTrack');
  const toeTrackLabel = document.getElementById('toeTrackLabel');
  const toeGuideV    = document.getElementById('toeGuideV');
  const toeGuideH    = document.getElementById('toeGuideH');
  const toeVideoRail = document.getElementById('toeVideoRail');
  const toePlayhead  = document.getElementById('toePlayhead');

  function toeActiveItem() { return toeItems.find(t => t.id === toeActiveId); }
  function toeGetEl(id) { return document.getElementById('toe2-el-' + id); }
  function toeFmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    const m = Math.floor(s / 60), ss = s % 60;
    return m + ':' + String(ss).padStart(2, '0');
  }

  function toeApplyStyle(el, item) {
    el.style.fontFamily = TOE_FONTS[item.font] || TOE_FONTS.classic;
    el.style.fontSize = item.size + 'px';
    el.style.color = item.color;
    el.style.textAlign = item.align;
    el.style.left = item.xPct + '%';
    el.style.top = item.yPct + '%';
    el.style.textShadow = item.font === 'neon'
      ? `0 0 8px ${item.color}, 0 0 16px ${item.color}` : 'none';
    if (item.bg === 'dark') { el.style.background = 'rgba(0,0,0,0.55)'; el.style.padding = '4px 10px'; el.style.borderRadius = '6px'; }
    else if (item.bg === 'solid') { el.style.background = '#000'; el.style.padding = '4px 10px'; el.style.borderRadius = '6px'; }
    else { el.style.background = 'transparent'; el.style.padding = '2px 4px'; el.style.borderRadius = '0'; }
  }

  function toeStartDrag(item, e) {
    if (e.target.classList.contains('toe2-el-del')) return;
    e.preventDefault();
    toeActivate(item.id);
    const pt = e.touches?.[0] || e;
    const rect = toeStage.getBoundingClientRect();
    const startX = pt.clientX, startY = pt.clientY;
    const baseX = item.xPct, baseY = item.yPct;
    const SNAP = 1.8; // % distance to snap + show center guide
    const move = (mv) => {
      const p = mv.touches?.[0] || mv;
      let nx = Math.max(3, Math.min(97, baseX + ((p.clientX - startX) / rect.width) * 100));
      let ny = Math.max(3, Math.min(97, baseY + ((p.clientY - startY) / rect.height) * 100));
      // Snap to center + show guide lines
      if (Math.abs(nx - 50) < SNAP) { nx = 50; if (toeGuideV) toeGuideV.classList.add('on'); } else if (toeGuideV) toeGuideV.classList.remove('on');
      if (Math.abs(ny - 50) < SNAP) { ny = 50; if (toeGuideH) toeGuideH.classList.add('on'); } else if (toeGuideH) toeGuideH.classList.remove('on');
      item.xPct = nx; item.yPct = ny;
      const el = toeGetEl(item.id);
      if (el) { el.style.left = item.xPct + '%'; el.style.top = item.yPct + '%'; }
    };
    const up = () => {
      if (toeGuideV) toeGuideV.classList.remove('on');
      if (toeGuideH) toeGuideH.classList.remove('on');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  function toeMakeEl(item) {
    const el = document.createElement('div');
    el.className = 'toe2-el';
    el.id = 'toe2-el-' + item.id;
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.textContent = item.text;
    toeApplyStyle(el, item);

    const del = document.createElement('button');
    del.className = 'toe2-el-del';
    del.type = 'button';
    del.textContent = '×';
    del.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      toeItems = toeItems.filter(t => t.id !== item.id);
      if (toeActiveId === item.id) toeActiveId = toeItems[0]?.id ?? null;
      toeRender();
      toeSyncTrack();
    });
    el.appendChild(del);

    el.addEventListener('pointerdown', (e) => toeStartDrag(item, e));
    el.addEventListener('input', () => {
      // first child text node holds the text; keep the delete button intact
      item.text = (el.childNodes[0]?.nodeType === 3 ? el.childNodes[0].textContent : el.innerText).replace(/\n+$/, '');
      toeSyncTrack();
    });
    el.addEventListener('focus', () => toeActivate(item.id));
    return el;
  }

  function toeRender() {
    toeTextLayer.innerHTML = '';
    toeItems.forEach(item => {
      const el = toeMakeEl(item);
      el.classList.toggle('toe2-active', item.id === toeActiveId);
      toeTextLayer.appendChild(el);
    });
    toeSyncVisibility();
  }

  function toeActivate(id) {
    if (toeActiveId === id) return;
    toeActiveId = id;
    toeTextLayer.querySelectorAll('.toe2-el').forEach(el => {
      el.classList.toggle('toe2-active', el.id === 'toe2-el-' + id);
    });
    toeSyncToolbar();
    toeSyncTrack();
  }

  function toeSyncToolbar() {
    const item = toeActiveItem();
    if (!item) return;
    toeFont = item.font; toeColor = item.color; toeSize = item.size; toeAlign = item.align; toeBg = item.bg;
    const fontSel = document.getElementById('toeFontSelect');
    if (fontSel) fontSel.value = toeFont;
    const sizeSl = document.getElementById('toeSizeSlider');
    if (sizeSl) sizeSl.value = toeSize;
    document.querySelectorAll('.toe2-sw').forEach(b => b.classList.toggle('active', b.dataset.color === toeColor));
    document.querySelectorAll('.toe2-al').forEach(b => b.classList.toggle('active', b.dataset.align === toeAlign));
    const bgBtn = document.getElementById('toeBgBtn');
    if (bgBtn) bgBtn.textContent = toeBg === 'none' ? 'Bg: Off' : toeBg === 'dark' ? 'Bg: Dark' : 'Bg: Solid';
  }

  function toeUpdateActive(prop, val) {
    const item = toeActiveItem();
    if (!item) return;
    item[prop] = val;
    const el = toeGetEl(item.id);
    if (el) toeApplyStyle(el, item);
    if (prop === 'text') toeSyncTrack();
  }

  function toeAddText() {
    const id = Date.now();
    toeItems.push({ id, text: 'Your text', font: toeFont, color: toeColor, size: toeSize, align: toeAlign, bg: toeBg, xPct: 50, yPct: 25, start: 0, end: 1 });
    toeActiveId = id;
    toeRender();
    toeSyncToolbar();
    toeSyncTrack();
    setTimeout(() => { const el = toeGetEl(id); if (el) el.focus(); }, 40);
  }

  // ---- Timeline text track (shows active text, draggable + trimmable) ----
  function toeSyncTrack() {
    if (!toeTextTrack) return;
    const item = toeActiveItem() || toeItems[0];
    if (!item || !toeIsVideo) { toeTextTrack.style.display = toeIsVideo ? 'flex' : 'none'; if (item && toeTrackLabel) toeTrackLabel.textContent = item.text || 'Text'; return; }
    toeTextTrack.style.display = 'flex';
    toeTextTrack.style.left = (item.start * 100) + '%';
    toeTextTrack.style.width = Math.max(8, (item.end - item.start) * 100) + '%';
    if (toeTrackLabel) toeTrackLabel.textContent = (item.text || 'Text').replace(/\s+/g, ' ').trim() || 'Text';
  }

  function toeSyncVisibility() {
    if (!toeIsVideo || !toeMediaEl) {
      toeItems.forEach(it => { const el = toeGetEl(it.id); if (el) el.classList.remove('toe2-hidden'); });
      return;
    }
    const dur = toeMediaEl.duration || 0;
    const frac = dur ? (toeMediaEl.currentTime / dur) : 0;
    toeItems.forEach(it => {
      const el = toeGetEl(it.id);
      if (el) el.classList.toggle('toe2-hidden', !(frac >= (it.start ?? 0) && frac <= (it.end ?? 1)));
    });
  }

  function toeBindTrackDrag() {
    if (!toeTextTrack) return;
    const onDown = (e) => {
      const item = toeActiveItem() || toeItems[0];
      if (!item) return;
      e.preventDefault();
      const edge = e.target.dataset?.edge;
      const railRect = toeTextTrack.parentElement.getBoundingClientRect();
      const baseStart = item.start, baseEnd = item.end;
      const startX = (e.touches?.[0] || e).clientX;
      const move = (mv) => {
        const p = mv.touches?.[0] || mv;
        const d = (p.clientX - startX) / railRect.width;
        if (edge === 'start') item.start = Math.max(0, Math.min(item.end - 0.05, baseStart + d));
        else if (edge === 'end') item.end = Math.min(1, Math.max(item.start + 0.05, baseEnd + d));
        else { const w = baseEnd - baseStart; let ns = Math.max(0, Math.min(1 - w, baseStart + d)); item.start = ns; item.end = ns + w; }
        toeSyncTrack();
        toeSyncVisibility();
      };
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    };
    toeTextTrack.addEventListener('pointerdown', onDown);
  }

  // ---- Video playback controls ----
  function toeWireVideo(vid) {
    toePlayBtn.textContent = '▶';
    const updatePlay = () => { toePlayBtn.textContent = vid.paused ? '▶' : '❚❚'; };
    toePlayBtn.onclick = () => { if (vid.paused) vid.play().catch(()=>{}); else vid.pause(); };
    vid.onplay = updatePlay;
    vid.onpause = updatePlay;
    vid.onended = () => { toePlayBtn.textContent = '▶'; };
    vid.ontimeupdate = () => {
      const dur = vid.duration || 0;
      const frac = dur ? (vid.currentTime / dur) : 0;
      if (toeSeek) toeSeek.value = String(Math.round(frac * 1000));
      if (toeTimeLabel) toeTimeLabel.textContent = toeFmt(vid.currentTime) + ' / ' + toeFmt(dur);
      if (toePlayhead) toePlayhead.style.left = (frac * 100) + '%';
      toeSyncVisibility();
    };
    vid.onloadedmetadata = () => {
      if (toeTimeLabel) toeTimeLabel.textContent = '0:00 / ' + toeFmt(vid.duration);
    };
    if (toeSeek) toeSeek.oninput = () => {
      const dur = vid.duration || 0;
      if (dur) { vid.currentTime = (Number(toeSeek.value) / 1000) * dur; toeSyncVisibility(); }
    };
  }

  // ---- Filmstrip: extract a few frames once (separate probe video, off the playback path) ----
  function toeBuildFilmstrip(file) {
    if (!toeVideoRail) return;
    toeVideoRail.querySelectorAll('.toe2-thumb').forEach(t => t.remove());
    let probe = document.createElement('video');
    probe.muted = true; probe.preload = 'auto'; probe.playsInline = true;
    try { probe.src = URL.createObjectURL(file); } catch (_) { return; }
    const COUNT = 6, shots = [];
    let idx = 0;
    const cleanup = () => { try { URL.revokeObjectURL(probe.src); } catch (_) {} try { probe.remove(); } catch (_) {} probe = null; };
    probe.onloadedmetadata = () => {
      const dur = probe.duration;
      if (!dur || !isFinite(dur)) { cleanup(); return; }
      const canvas = document.createElement('canvas');
      const ratio = (probe.videoHeight && probe.videoWidth) ? probe.videoHeight / probe.videoWidth : 1.6;
      canvas.width = 90; canvas.height = Math.round(90 * ratio);
      const ctx = canvas.getContext('2d');
      const render = () => shots.forEach(src => {
        const t = document.createElement('span');
        t.className = 'toe2-thumb';
        t.style.backgroundImage = `url('${src}')`;
        if (toePlayhead) toeVideoRail.insertBefore(t, toePlayhead); else toeVideoRail.appendChild(t);
      });
      const next = () => {
        if (idx >= COUNT || !probe) { render(); cleanup(); return; }
        try { probe.currentTime = Math.min(dur - 0.05, (idx + 0.5) * (dur / COUNT)); } catch (_) { render(); cleanup(); }
      };
      probe.onseeked = () => {
        try { ctx.drawImage(probe, 0, 0, canvas.width, canvas.height); shots.push(canvas.toDataURL('image/jpeg', 0.6)); } catch (_) {}
        idx++; next();
      };
      next();
    };
    probe.onerror = cleanup;
  }

  // ---- Open / Close ----
  function toeOpen(mediaFile) {
    const editable = mediaFile?._toeSourceFile || mediaFile;
    toeSourceFile = editable;
    toeItems = Array.isArray(mediaFile?._toeTextElements)
      ? JSON.parse(JSON.stringify(mediaFile._toeTextElements)) : [];
    toeActiveId = toeItems[0]?.id ?? null;
    toeFont = 'classic'; toeColor = '#ffffff'; toeSize = 40; toeAlign = 'center'; toeBg = 'none';

    toeStage.querySelectorAll('img,video').forEach(e => { try { URL.revokeObjectURL(e.src); } catch(_){} e.remove(); });
    toeIsVideo = editable.type?.startsWith('video/') || editable._isVideo || false;

    if (toeIsVideo) {
      const vid = document.createElement('video');
      vid.src = URL.createObjectURL(editable);
      vid.playsInline = true; vid.preload = 'auto'; vid.controls = false;
      vid.className = 'toe2-media';
      toeStage.insertBefore(vid, toeTextLayer);
      toeMediaEl = vid;
      toeVideoBar.style.display = 'flex';
      toeWireVideo(vid);
      toeBuildFilmstrip(editable);
    } else {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(editable);
      img.className = 'toe2-media';
      toeStage.insertBefore(img, toeTextLayer);
      toeMediaEl = img;
      toeVideoBar.style.display = 'none';
    }

    if (toeProcessing) toeProcessing.style.display = 'none';
    toeOverlay.style.display = 'flex';
    toeRender();
    toeSyncToolbar();
    toeSyncTrack();
  }

  function toeClose() {
    if (toeMediaEl?.tagName === 'VIDEO') { try { toeMediaEl.pause(); } catch(_){} }
    toeStage.querySelectorAll('img,video').forEach(e => { try { URL.revokeObjectURL(e.src); } catch(_){} e.remove(); });
    toeMediaEl = null;
    toeOverlay.style.display = 'none';
  }

  // ---- Burn text onto an image (high quality canvas) ----
  // Shared: draw one text item onto a canvas context (used by image + video bake)
  function toeDrawText(ctx, item, cw, ch, scale) {
    const fpx = item.size * scale;
    ctx.font = `${fpx}px ${TOE_FONTS[item.font] || TOE_FONTS.classic}`;
    ctx.textAlign = item.align === 'left' ? 'left' : item.align === 'right' ? 'right' : 'center';
    ctx.textBaseline = 'middle';
    const x = (item.xPct / 100) * cw;
    const y = (item.yPct / 100) * ch;
    const lines = (item.text || '').split('\n');
    const lh = fpx * 1.25;
    lines.forEach((line, i) => {
      const ly = y + (i - (lines.length - 1) / 2) * lh;
      if (item.bg !== 'none') {
        const tw = ctx.measureText(line).width;
        const bx = item.align === 'center' ? x - tw / 2 - 10 : item.align === 'right' ? x - tw - 10 : x - 10;
        ctx.fillStyle = item.bg === 'solid' ? '#000' : 'rgba(0,0,0,0.55)';
        ctx.fillRect(bx, ly - lh / 2, tw + 20, lh);
      }
      if (item.font === 'neon') { ctx.shadowColor = item.color; ctx.shadowBlur = fpx * 0.4; } else { ctx.shadowBlur = 0; }
      ctx.fillStyle = item.color;
      ctx.fillText(line, x, ly);
      ctx.shadowBlur = 0;
    });
  }

  function toePickVideoMime() {
    const opts = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
      for (const m of opts) { if (MediaRecorder.isTypeSupported(m)) return m; }
    }
    return 'video/webm';
  }

  async function toeBurnImage(imgEl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 1080;
        canvas.height = img.naturalHeight || 1350;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const scale = canvas.width / (toeStage.querySelector('.toe2-media')?.clientWidth || canvas.width);
        toeItems.forEach(item => toeDrawText(ctx, item, canvas.width, canvas.height, scale));
        canvas.toBlob(b => resolve(b), 'image/jpeg', 0.92);
      };
      img.src = imgEl.src;
    });
  }

  // Bake text into the video, in-browser, at high bitrate. Audio preserved. Free — runs on the user's machine.
  async function toeBurnVideo(file) {
    return new Promise((resolve, reject) => {
      const displayW = toeStage.querySelector('.toe2-media')?.clientWidth || 1080;
      const v = document.createElement('video');
      v.src = URL.createObjectURL(file);
      v.playsInline = true; v.preload = 'auto';
      v.onloadedmetadata = () => {
        const W = v.videoWidth || 1080, H = v.videoHeight || 1920;
        const dur = v.duration || 0;
        const scale = W / displayW;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        const fps = 30;
        const stream = canvas.captureStream(fps);
        // Carry the original audio track into the output
        try {
          const vStream = v.captureStream ? v.captureStream() : (v.mozCaptureStream ? v.mozCaptureStream() : null);
          if (vStream) vStream.getAudioTracks().forEach(t => stream.addTrack(t));
        } catch (_) {}
        const mime = toePickVideoMime();
        let recorder;
        try { recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10000000 }); }
        catch (_) { try { recorder = new MediaRecorder(stream); } catch (e) { reject(e); return; } }
        const chunks = [];
        let raf;
        recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.onstop = () => {
          cancelAnimationFrame(raf);
          try { URL.revokeObjectURL(v.src); } catch (_) {}
          resolve({ blob: new Blob(chunks, { type: (mime.split(';')[0] || 'video/webm') }), mime });
        };
        const draw = () => {
          ctx.drawImage(v, 0, 0, W, H);
          const frac = dur ? (v.currentTime / dur) : 0;
          toeItems.forEach(item => {
            if (frac >= (item.start ?? 0) && frac <= (item.end ?? 1)) toeDrawText(ctx, item, W, H, scale);
          });
          if (toeProcLabel && dur) toeProcLabel.textContent = `Rendering video... ${Math.round(frac * 100)}%`;
          if (!v.paused && !v.ended) raf = requestAnimationFrame(draw);
        };
        v.onended = () => { if (recorder.state !== 'inactive') recorder.stop(); };
        recorder.start(250);
        v.currentTime = 0;
        v.play().then(() => { raf = requestAnimationFrame(draw); }).catch(reject);
      };
      v.onerror = () => reject(new Error('Could not load video for rendering.'));
    });
  }

  // ---- Save ----
  async function toeSave() {
    if (toeItems.length === 0) { toeClose(); return; }
    toeProcessing.style.display = 'flex';

    if (toeIsVideo) {
      // Bake text into the video in-browser (high bitrate, audio preserved). Free.
      toeProcLabel.textContent = 'Rendering video... 0%';
      try {
        const source = toeSourceFile || uploadedFile;
        const { blob, mime } = await toeBurnVideo(source);
        const ext = mime.includes('mp4') ? 'mp4' : 'webm';
        const newFile = new File([blob], `overlay_${Date.now()}.${ext}`, { type: blob.type });
        newFile._isVideo = true;
        newFile._toeSourceFile = source;                 // keep ORIGINAL for re-editing
        newFile._toeTextElements = JSON.parse(JSON.stringify(toeItems));
        newFile._hasTextOverlay = true;
        uploadedFile = newFile;
        uploadedFile._uploading = true;
        uploadedFile._uploadError = false;

        const v = els.uploadZone.querySelector('video') || document.createElement('video');
        v.src = URL.createObjectURL(blob);
        v.controls = true; v.muted = false; v.preload = 'metadata'; v.playsInline = true;
        v.style.cssText = 'max-width:100%;border-radius:12px;';
        els.uploadZone.querySelectorAll('video').forEach(o => { if (o !== v) o.remove(); });
        if (!v.parentElement) els.uploadZone.appendChild(v);
        els.uploadPreview.style.display = 'none';

        setAddTextButtonState(true); setEditMediaButtonState(true); setReturnToEditorButtonState(true);
        if (els.addTextBtn) { els.addTextBtn.classList.add('has-overlay'); els.addTextBtn.textContent = 'Edit Text'; }

        const target = uploadedFile;
        uploadedFile._uploadPromise = uploadMediaToSupabase(newFile).then(url => {
          if (uploadedFile !== target) return url;
          target._uploading = false;
          if (url) { target._supabaseUrl = url; showToast('Text added to your video!'); }
          else { target._uploadError = true; showToast('Upload failed — tap Retry Media Upload.'); }
          validateForm();
          return url;
        }).catch(() => { if (uploadedFile === target) { target._uploading = false; target._uploadError = true; } validateForm(); return null; });

        toeClose(); validateForm();
      } catch (err) {
        console.error('Video burn error:', err);
        showToast('Could not render the video — please try again.');
        toeProcessing.style.display = 'none';
      }
      return;
    }

    // Image: burn now (instant, full quality)
    toeProcLabel.textContent = 'Applying text...';
    try {
      const mediaEl = toeStage.querySelector('.toe2-media');
      const blob = await toeBurnImage(mediaEl);
      const newFile = new File([blob], `overlay_${Date.now()}.jpg`, { type: 'image/jpeg' });
      newFile._isVideo = false;
      newFile._toeSourceFile = toeSourceFile || uploadedFile;
      newFile._toeTextElements = JSON.parse(JSON.stringify(toeItems));
      newFile._hasTextOverlay = true;
      uploadedFile = newFile;
      uploadedFile._uploading = true;
      uploadedFile._uploadError = false;

      els.uploadPreview.src = URL.createObjectURL(blob);
      els.uploadPreview.classList.add('visible');
      els.uploadPreview.style.display = '';

      setAddTextButtonState(true); setEditMediaButtonState(true); setReturnToEditorButtonState(true);
      if (els.addTextBtn) { els.addTextBtn.classList.add('has-overlay'); els.addTextBtn.textContent = 'Edit Text'; }

      const target = uploadedFile;
      uploadedFile._uploadPromise = uploadMediaToSupabase(newFile).then(url => {
        if (uploadedFile !== target) return url;
        target._uploading = false;
        if (url) { target._supabaseUrl = url; showToast('Text overlay applied!'); }
        else { target._uploadError = true; showToast('Upload failed — tap Retry Media Upload.'); }
        validateForm();
        return url;
      }).catch(() => { if (uploadedFile === target) { target._uploading = false; target._uploadError = true; } validateForm(); return null; });

      toeClose(); validateForm();
    } catch (err) {
      console.error('Text burn error:', err);
      showToast('Error applying text — try again.');
      toeProcessing.style.display = 'none';
    }
  }

  // ---- Wire toolbar ----
  document.getElementById('toeAddTextBtn')?.addEventListener('click', toeAddText);
  document.getElementById('toeDeleteBtn')?.addEventListener('click', () => {
    if (toeActiveId == null) return;
    toeItems = toeItems.filter(t => t.id !== toeActiveId);
    toeActiveId = toeItems[0]?.id ?? null;
    toeRender(); toeSyncTrack();
  });
  document.getElementById('toeFontSelect')?.addEventListener('change', (e) => { toeFont = e.target.value; toeUpdateActive('font', toeFont); });
  document.getElementById('toeSizeSlider')?.addEventListener('input', (e) => { toeSize = Number(e.target.value); toeUpdateActive('size', toeSize); });
  document.querySelectorAll('.toe2-sw').forEach(b => {
    if (!b.dataset.color) return;
    b.addEventListener('click', () => { toeColor = b.dataset.color; document.querySelectorAll('.toe2-sw').forEach(x => x.classList.remove('active')); b.classList.add('active'); toeUpdateActive('color', toeColor); });
  });
  document.getElementById('toeColorPicker')?.addEventListener('input', (e) => { toeColor = e.target.value; document.querySelectorAll('.toe2-sw').forEach(x => x.classList.remove('active')); toeUpdateActive('color', toeColor); });
  document.querySelectorAll('.toe2-al').forEach(b => {
    b.addEventListener('click', () => { toeAlign = b.dataset.align; document.querySelectorAll('.toe2-al').forEach(x => x.classList.remove('active')); b.classList.add('active'); toeUpdateActive('align', toeAlign); });
  });
  document.getElementById('toeBgBtn')?.addEventListener('click', () => {
    const modes = ['none', 'dark', 'solid'];
    toeBg = modes[(modes.indexOf(toeBg) + 1) % modes.length];
    document.getElementById('toeBgBtn').textContent = toeBg === 'none' ? 'Bg: Off' : toeBg === 'dark' ? 'Bg: Dark' : 'Bg: Solid';
    toeUpdateActive('bg', toeBg);
  });
  document.getElementById('toeCancelBtn')?.addEventListener('click', toeClose);
  document.getElementById('toeDoneBtn')?.addEventListener('click', toeSave);
  toeBindTrackDrag();
  // ========== SCHEDULER MODAL ==========
  let selectedType = 'post';
  let uploadedFile = null;
  let editingPostId = null; // Track which post is being edited
  let userSelectedThumbnail = ''; // User's manually captured thumbnail
  const addTextButtonDefaultHtml = els.addTextBtn?.innerHTML || '';

  function setAddTextButtonState(visible, disabled = false) {
    if (!els.addTextBtn) return;
    els.addTextBtn.style.display = visible ? '' : 'none';
    els.addTextBtn.classList.toggle('is-disabled', disabled);
    if (!visible || disabled) els.addTextBtn.classList.remove('has-overlay');
    els.addTextBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    els.addTextBtn.title = disabled
      ? 'Re-upload this media to add text overlays safely'
      : 'Add text overlay to your media';
    els.addTextBtn.innerHTML = disabled
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg> Re-upload to add text'
      : addTextButtonDefaultHtml;
  }

  function setEditMediaButtonState(visible, disabled = false) {
    if (!els.editMediaBtn) return;
    els.editMediaBtn.style.display = visible ? '' : 'none';
    els.editMediaBtn.classList.toggle('is-disabled', disabled);
    els.editMediaBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  }

  function setReturnToEditorButtonState(visible) {
    if (!els.returnToEditorBtn) return;
    els.returnToEditorBtn.style.display = 'none';
  }

  function openScheduler(date, suggestedTime) {
    editingPostId = null; // New post mode
    userSelectedThumbnail = '';
    state.selectedDate = date;
    els.dateInput.value = date;
    if (suggestedTime) {
      els.timeInput.value = convertTo24(suggestedTime);
    } else {
      els.timeInput.value = '09:00';
    }
    els.captionInput.value = '';
    els.hashtagInput.value = '';
    els.captionCount.textContent = '0';
    els.uploadPreview.classList.remove('visible');
    if (els.captureThumbBtn) els.captureThumbBtn.style.display = 'none';
    if (els.capturedThumbPreview) els.capturedThumbPreview.style.display = 'none';
    if (els.removeMediaBtn) els.removeMediaBtn.style.display = 'none';
    setAddTextButtonState(false);
    setEditMediaButtonState(false);
    setReturnToEditorButtonState(false);
    els.uploadPlaceholder.style.display = '';
    els.uploadZone.querySelectorAll('video').forEach(v => v.remove());
    uploadedFile = null;
    selectedType = 'post';
    // Reset type buttons
    els.typeButtons = $$('.type-btn');
    els.typeButtons.forEach(b => b.classList.toggle('active', b.dataset.type === 'post'));
    els.modalTitle.textContent = 'Schedule New Post';
    els.schedulePostBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg> Schedule Post`;
    // Show upload section for non-live types
    const uploadSection = els.uploadZone.closest('.upload-section');
    if (uploadSection) uploadSection.style.display = '';
    renderModalBestTimes();
    validateForm();
    els.modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  // ========== EDIT MODAL ==========
  function openEditModal(postId) {
    const post = state.posts.find(p => String(p.id) === String(postId));
    if (!post) return;

    editingPostId = post.id;
    state.selectedDate = post.date;
    els.dateInput.value = post.date;
    els.timeInput.value = post.time || '09:00';
    els.captionInput.value = post.caption || '';
    els.hashtagInput.value = post.hashtags || '';
    els.captionCount.textContent = String((post.caption || '').length);

    // Handle media preview
    els.uploadPreview.classList.remove('visible');
    if (els.captureThumbBtn) els.captureThumbBtn.style.display = 'none';
    if (els.capturedThumbPreview) els.capturedThumbPreview.style.display = 'none';
    if (els.removeMediaBtn) els.removeMediaBtn.style.display = 'none';
    setAddTextButtonState(false);
    setEditMediaButtonState(false);
    setReturnToEditorButtonState(false);
    els.uploadPlaceholder.style.display = 'none';
    els.uploadZone.querySelectorAll('video').forEach(v => v.remove());
    uploadedFile = { _existing: true }; // Mark as having existing media
    userSelectedThumbnail = '';

    if (post.video_url) {
      uploadedFile._isVideo = true;
      uploadedFile._sourceUrl = post.video_url;
      uploadedFile._sourceName = 'existing-video.mp4';
      const videoEl = document.createElement('video');
      videoEl.src = post.video_url;
      videoEl.controls = true;
      videoEl.setAttribute('playsinline', '');
      els.uploadZone.appendChild(videoEl);
      if (els.removeMediaBtn) els.removeMediaBtn.style.display = '';
      setAddTextButtonState(true);
      setEditMediaButtonState(true);
      
      videoEl.addEventListener('seeked', () => {
        if (els.captureThumbBtn && !userSelectedThumbnail) els.captureThumbBtn.style.display = '';
      });

      if (post.image_url) {
        userSelectedThumbnail = post.image_url;
        if (els.capturedThumbPreview) {
          els.capturedThumbPreview.src = userSelectedThumbnail;
          els.capturedThumbPreview.style.display = 'block';
        }
      }
    } else if (post.image_url) {
      uploadedFile._isVideo = false;
      uploadedFile._sourceUrl = post.image_url;
      uploadedFile._sourceName = 'existing-image.jpg';
      if (els.removeMediaBtn) els.removeMediaBtn.style.display = '';
      setAddTextButtonState(true);
      setEditMediaButtonState(true);
      els.uploadPreview.src = post.image_url;
      els.uploadPreview.classList.add('visible');
      els.uploadPreview.style.display = '';
    } else {
      uploadedFile = null;
      els.uploadPlaceholder.style.display = '';
    }

    // Set type
    selectedType = post.type || 'post';
    els.typeButtons = $$('.type-btn');
    els.typeButtons.forEach(b => b.classList.toggle('active', b.dataset.type === selectedType));

    // Dynamic title based on post type
    const typeLabel = (POST_TYPES[post.type] || POST_TYPES.post).label;
    if (post.type === 'live') {
      els.modalTitle.textContent = 'Edit Schedule Live';
      // Hide upload section for live
      const uploadSection = els.uploadZone.closest('.upload-section');
      if (uploadSection) uploadSection.style.display = 'none';
      uploadedFile = { _existing: true, _isLive: true };
    } else {
      els.modalTitle.textContent = `Edit Active ${typeLabel}`;
      const uploadSection = els.uploadZone.closest('.upload-section');
      if (uploadSection) uploadSection.style.display = '';
    }

    // Change button text to Update
    els.schedulePostBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg> Update ${typeLabel}`;

    renderModalBestTimes();
    validateForm();
    els.modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  // Update an existing post
  async function updatePost(postId, updatedData) {
    const idx = state.posts.findIndex(p => String(p.id) === String(postId));
    if (idx === -1) return false;
    const previous = { ...state.posts[idx] };

    // Update in Supabase if configured
    if (isSupabaseConfigured) {
      try {
        const scheduledTime = `${updatedData.date}T${updatedData.time || '09:00'}:00`;
        const { error } = await supabase.from('posts').update({
          caption: updatedData.caption,
          hashtags: updatedData.hashtags || '',
          post_type: updatedData.type || 'post',
          scheduled_time: scheduledTime,
          image_url: updatedData.image_url || '',
          video_url: updatedData.video_url || '',
          media_type: updatedData.media_type || 'IMAGE',
        }).eq('id', postId);
        if (error) throw error;
      } catch (e) {
        console.error('Update error:', e);
        state.posts[idx] = previous;
        savePosts();
        return false;
      }
    }

    Object.assign(state.posts[idx], updatedData);
    savePosts();
    return true;
  }

  // Delete a post
  function deletePost(postId) {
    state.posts = state.posts.filter(p => String(p.id) !== String(postId));
    savePosts();
    if (isSupabaseConfigured) {
      supabase.from('posts').delete().eq('id', postId).then(() => { }).catch(e => console.error('Delete error:', e));
    }
  }

  function resetModalForBackToBack() {
    editingPostId = null;
    els.captionInput.value = '';
    els.hashtagInput.value = '';
    els.captionCount.textContent = '0';
    els.uploadPreview.classList.remove('visible');
    els.uploadPreview.style.display = 'none';
    if (els.captureThumbBtn) els.captureThumbBtn.style.display = 'none';
    if (els.capturedThumbPreview) els.capturedThumbPreview.style.display = 'none';
    if (els.removeMediaBtn) els.removeMediaBtn.style.display = 'none';
    setAddTextButtonState(false);
    setEditMediaButtonState(false);
    setReturnToEditorButtonState(false);
    els.uploadPlaceholder.style.display = '';
    els.uploadZone.querySelectorAll('video').forEach(v => v.remove());
    uploadedFile = null;
    userSelectedThumbnail = '';
    selectedType = 'post';
    els.typeButtons = $$('.type-btn');
    els.typeButtons.forEach(b => b.classList.toggle('active', b.dataset.type === 'post'));
    els.timeInput.value = '09:00';
    els.modalTitle.textContent = 'Schedule New Post';
    els.schedulePostBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg> Schedule Post`;
    const uploadSection = els.uploadZone.closest('.upload-section');
    if (uploadSection) uploadSection.style.display = '';
    // Keep date the same for convenience
    validateForm();
  }

  function closeModal() {
    els.modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    // If the actions page is still open behind the modal, re-render it
    if (els.actionsPageOverlay && els.actionsPageOverlay.classList.contains('active')) {
      document.body.style.overflow = 'hidden'; // keep body locked for actions page
      renderActionsPage();
    }
  }

  els.modalClose.addEventListener('click', closeModal);
  els.modalOverlay.addEventListener('click', (e) => {
    if (e.target === els.modalOverlay) closeModal();
  });
  els.newPostBtn.addEventListener('click', () => {
    const todayStr = formatDate(state.today.getFullYear(), state.today.getMonth(), state.today.getDate());
    openScheduler(todayStr);
  });

  // ========== FORM VALIDATION ==========
  function restoreScheduleButtonLabel() {
    const typeLabel = (POST_TYPES[selectedType] || POST_TYPES.post).label;
    const actionLabel = editingPostId ? `Update ${typeLabel}` : 'Schedule Post';
    els.schedulePostBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg> ${actionLabel}`;
  }

  async function retryCurrentMediaUpload() {
    if (!uploadedFile || uploadedFile._existing || uploadedFile._uploading) return;
    uploadedFile._uploading = true;
    uploadedFile._uploadError = false;
    validateForm();
    const url = await uploadMediaToSupabase(uploadedFile);
    uploadedFile._uploading = false;
    if (url) {
      uploadedFile._supabaseUrl = url;
      showToast('Media ready to schedule.');
    } else {
      uploadedFile._uploadError = true;
      showToast('Upload failed again — please re-upload the media.');
    }
    validateForm();
  }

  function validateForm() {
    const isLive = selectedType === 'live';
    const hasMedia = isLive || !!uploadedFile;
    const hasCaption = els.captionInput.value.trim().length > 0;
    const hasDate = !!els.dateInput.value;
    const hasTime = !!els.timeInput.value;
    const hasType = !!selectedType;
    const isUploading = uploadedFile?._uploading === true;
    const hasUploadError = uploadedFile?._uploadError === true;
    const isValid = hasMedia && hasCaption && hasDate && hasTime && hasType && !isUploading && !hasUploadError;

    els.schedulePostBtn.classList.toggle('btn-disabled', !isValid && !hasUploadError);
    els.schedulePostBtn.classList.toggle('btn-glow', isValid || hasUploadError);
    els.schedulePostBtn.disabled = !isValid && !hasUploadError;

    if (isUploading) {
      els.schedulePostBtn.innerHTML = '<span style="display:inline-block;margin-right:6px;">⏳</span> Preparing media...';
    } else if (hasUploadError) {
      els.schedulePostBtn.innerHTML = '<span style="display:inline-block;margin-right:6px;">↻</span> Retry Media Upload';
    } else if (!els.schedulePostBtn.innerHTML.includes('Schedule Post') && !els.schedulePostBtn.innerHTML.includes('Update ')) {
      restoreScheduleButtonLabel();
    }
  }

  // Caption counter & validation
  els.captionInput.addEventListener('input', () => {
    els.captionCount.textContent = els.captionInput.value.length;
    validateForm();
  });
  els.dateInput.addEventListener('change', validateForm);
  els.timeInput.addEventListener('change', validateForm);

  // Type buttons (use event delegation since buttons are in HTML)
  document.querySelector('.post-type-select')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.type-btn');
    if (!btn) return;
    selectedType = btn.dataset.type;
    document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b === btn));
    // Toggle upload section visibility for live type
    const uploadSection = els.uploadZone.closest('.upload-section');
    if (selectedType === 'live') {
      if (uploadSection) uploadSection.style.display = 'none';
    } else {
      if (uploadSection) uploadSection.style.display = '';
    }
    // Update modal title if editing
    if (editingPostId) {
      const typeLabel = (POST_TYPES[selectedType] || POST_TYPES.post).label;
      if (selectedType === 'live') {
        els.modalTitle.textContent = 'Edit Schedule Live';
      } else {
        els.modalTitle.textContent = `Edit Active ${typeLabel}`;
      }
      els.schedulePostBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg> Update ${typeLabel}`;
    }
    validateForm();
  });

  // File upload
  els.uploadZone.addEventListener('click', (e) => {
    if (e.target.closest('#uploadPreview')) return;
    if (e.target.closest('#removeMediaBtn')) return;
    if (e.target.closest('#addTextBtn')) return;
    if (e.target.closest('.capture-thumb-btn')) return;
    if (e.target.closest('video')) return;
    els.fileInput.click();
  });
  els.fileInput.addEventListener('change', () => handleFileUpload());
  els.uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.uploadZone.classList.add('drag-over');
  });
  els.uploadZone.addEventListener('dragleave', () => {
    els.uploadZone.classList.remove('drag-over');
  });
  els.uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) {
      els.fileInput.files = e.dataTransfer.files;
      handleFileUpload();
    }
  });

  function handleFileUpload(fileOverride = null) {
    const file = fileOverride instanceof File ? fileOverride : els.fileInput.files[0];
    if (!file) return;
    uploadedFile = file;
    if (els.addTextBtn) els.addTextBtn.classList.remove('has-overlay');
    setEditMediaButtonState(false);
    setReturnToEditorButtonState(false);
    uploadedFile._uploadError = false;

    // Detect if the uploaded file is a video
    const isVideo = file.type.startsWith('video/');
    uploadedFile._isVideo = isVideo;

    if (isVideo) {
      // For video files, show a video element instead of an image
      const videoEl = document.createElement('video');
      videoEl.src = URL.createObjectURL(file);
      videoEl.controls = true;
      videoEl.muted = false;
      videoEl.preload = 'metadata';
      videoEl.playsInline = true;
      videoEl.style.maxWidth = '100%';
      // Removed maxHeight because object-fit cover takes care of fitting it correctly
      // videoEl.style.maxHeight = '300px'; 
      videoEl.style.borderRadius = '12px';
      els.uploadPreview.style.display = 'none';
      els.uploadPlaceholder.style.display = 'none';
      // Remove any previous video preview
      els.uploadZone.querySelectorAll('video').forEach(v => v.remove());
      els.uploadZone.appendChild(videoEl);
      if (els.removeMediaBtn) els.removeMediaBtn.style.display = '';
      setAddTextButtonState(true);
      setEditMediaButtonState(true);
      if (els.captureThumbBtn) els.captureThumbBtn.style.display = 'none';
      
      videoEl.addEventListener('seeked', () => {
        if (els.captureThumbBtn && !userSelectedThumbnail) els.captureThumbBtn.style.display = '';
      });
      
      validateForm();
    } else {
      // For images, use the existing preview
      els.uploadZone.querySelectorAll('video').forEach(v => v.remove());
      if (els.captureThumbBtn) els.captureThumbBtn.style.display = 'none';
      if (els.capturedThumbPreview) els.capturedThumbPreview.style.display = 'none';
      if (els.removeMediaBtn) els.removeMediaBtn.style.display = '';
      setAddTextButtonState(true);
      setEditMediaButtonState(true);
      userSelectedThumbnail = '';
      els.uploadPreview.style.display = '';
      const reader = new FileReader();
      reader.onload = (e) => {
        els.uploadPreview.src = e.target.result;
        els.uploadPreview.classList.add('visible');
        els.uploadPlaceholder.style.display = 'none';
        validateForm();
      };
      reader.readAsDataURL(file);
    }

    // Upload to Supabase Storage — lock Schedule button until complete
    if (isSupabaseConfigured) {
      uploadedFile._uploading = true;

      // Show uploading indicator in the upload zone
      const uploadIndicator = document.createElement('div');
      uploadIndicator.id = 'uploadProgressIndicator';
      uploadIndicator.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#E1306C,#833AB4);border-radius:0 0 12px 12px;animation:uploadPulse 1.2s ease-in-out infinite;';
      els.uploadZone.style.position = 'relative';
      const existing = document.getElementById('uploadProgressIndicator');
      if (existing) existing.remove();
      els.uploadZone.appendChild(uploadIndicator);

      // Add pulse animation if not already present
      if (!document.getElementById('uploadPulseStyle')) {
        const style = document.createElement('style');
        style.id = 'uploadPulseStyle';
        style.textContent = '@keyframes uploadPulse{0%,100%{opacity:1}50%{opacity:0.4}}';
        document.head.appendChild(style);
      }

      // Disable Schedule button while uploading
      els.schedulePostBtn.classList.add('btn-disabled');
      els.schedulePostBtn.disabled = true;

      const uploadTarget = uploadedFile;
      uploadedFile._uploadPromise = uploadMediaToSupabase(file).then(url => {
        if (uploadedFile !== uploadTarget) return url;
        uploadTarget._uploading = false;
        const indicator = document.getElementById('uploadProgressIndicator');
        if (indicator) indicator.remove();

        if (url) {
          uploadTarget._uploadError = false;
          uploadTarget._supabaseUrl = url;
          // Re-run validation to re-enable Schedule button now that upload is ready
          validateForm();
        } else {
          uploadTarget._uploadError = true;
          showToast('Media upload failed — video kept. Tap Retry Media Upload.');
          setAddTextButtonState(true);
          setEditMediaButtonState(true);
          validateForm();
        }
        return url;
      }).catch(err => {
        console.error('Media upload failed:', err);
        if (uploadedFile === uploadTarget) {
          uploadTarget._uploading = false;
          uploadTarget._uploadError = true;
        }
        const indicator = document.getElementById('uploadProgressIndicator');
        if (indicator) indicator.remove();
        showToast('Media upload timed out — please try again.');
        validateForm();
        return null;
      });
    }
  }

  // Handle Thumbnail Capture Button
  if (els.captureThumbBtn) {
    els.captureThumbBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const videoEl = els.uploadZone.querySelector('video');
      if (!videoEl || videoEl.readyState < 2) {
        showToast('Video not ready yet');
        return;
      }
      try {
        const isOriginalVertical = videoEl.videoHeight > videoEl.videoWidth;
        const tempCanvas = document.createElement('canvas');
        const maxThumbEdge = window.matchMedia('(max-width: 768px)').matches ? 540 : 720;
        if (isOriginalVertical) {
          tempCanvas.width = maxThumbEdge;
          tempCanvas.height = Math.floor((videoEl.videoHeight / videoEl.videoWidth) * maxThumbEdge);
        } else {
          tempCanvas.height = maxThumbEdge;
          tempCanvas.width = Math.floor((videoEl.videoWidth / videoEl.videoHeight) * maxThumbEdge);
        }
        if (!Number.isFinite(tempCanvas.width) || tempCanvas.width <= 0) tempCanvas.width = maxThumbEdge;
        if (!Number.isFinite(tempCanvas.height) || tempCanvas.height <= 0) tempCanvas.height = maxThumbEdge;
        
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(videoEl, 0, 0, tempCanvas.width, tempCanvas.height);
        
        const base64 = tempCanvas.toDataURL('image/jpeg', 0.72);
        userSelectedThumbnail = base64; // show preview immediately

        if (els.capturedThumbPreview) {
          els.capturedThumbPreview.src = base64;
          els.capturedThumbPreview.style.display = 'block';
        }
        if (els.captureThumbBtn) els.captureThumbBtn.style.display = 'none';
        showToast('Thumbnail captured — uploading...');

        // Upload thumbnail to Supabase Storage to get a real public URL
        if (isSupabaseConfigured) {
          try {
            const userId = await getCurrentUserId();
            if (userId) {
              // Convert base64 to Blob
              const res = await fetch(base64);
              const blob = await res.blob();
              const fileName = `${userId}/thumb_${Date.now()}.jpg`;
              const { data: upData, error: upErr } = await supabase.storage
                .from('media_uploads')
                .upload(fileName, blob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });
              if (!upErr && upData) {
                const { data: urlData } = supabase.storage.from('media_uploads').getPublicUrl(upData.path);
                if (urlData?.publicUrl) {
                  userSelectedThumbnail = urlData.publicUrl;
                  if (els.captureThumbBtn) els.captureThumbBtn.style.display = 'none';
                  showToast('Thumbnail saved!');
                }
              }
            }
          } catch (thumbErr) {
            console.warn('Thumbnail upload failed, using base64 fallback:', thumbErr);
          }
        }
        if (els.captureThumbBtn) els.captureThumbBtn.style.display = 'none';
      } catch (err) {
        console.warn('Could not capture video thumbnail:', err);
        showToast('Error capturing thumbnail');
      }
    });
  }

  // Remove Media Button logic
  // Add Text button — open the text overlay editor
  async function resolveTextEditorMediaFile() {
    if (!uploadedFile) return null;
    if (!uploadedFile._existing) return uploadedFile;

    const videoEl = els.uploadZone.querySelector('video');
    const sourceUrl = uploadedFile._sourceUrl || videoEl?.src || els.uploadPreview?.src;
    if (!sourceUrl) {
      showToast('Re-upload this media to add text overlays.');
      return null;
    }

    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`Could not load media (${response.status})`);
      const blob = await response.blob();
      const type = blob.type || (uploadedFile._isVideo ? 'video/mp4' : 'image/jpeg');
      const name = uploadedFile._sourceName || `existing-media.${uploadedFile._isVideo ? 'mp4' : 'jpg'}`;
      const file = new File([blob], name, { type });
      file._isVideo = uploadedFile._isVideo || type.startsWith('video/');
      return file;
    } catch (err) {
      console.error('Could not prepare existing media for text overlay:', err);
      showToast('Could not open this media for editing. Please re-upload it.');
      return null;
    }
  }

  if (els.addTextBtn) {
    els.addTextBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!uploadedFile) return;
      if (els.addTextBtn.classList.contains('is-disabled')) {
        showToast('Re-upload this media to add text overlays.');
        return;
      }
      const mediaFile = await resolveTextEditorMediaFile();
      if (mediaFile) toeOpen(mediaFile);
    });
  }

  if (els.editMediaBtn) {
    els.editMediaBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (els.editMediaBtn.classList.contains('is-disabled')) return;
      showToast('Media editing page is next in the build.');
    });
  }

  if (els.returnToEditorBtn) {
    els.returnToEditorBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!uploadedFile || !uploadedFile._hasTextOverlay) return;
      const mediaFile = await resolveTextEditorMediaFile();
      if (mediaFile) toeOpen(mediaFile);
    });
  }

  if (els.removeMediaBtn) {
    els.removeMediaBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      els.uploadPreview.classList.remove('visible');
      els.uploadPreview.style.display = 'none';
      els.uploadPreview.src = '';
      
      if (els.captureThumbBtn) els.captureThumbBtn.style.display = 'none';
      if (els.capturedThumbPreview) els.capturedThumbPreview.style.display = 'none';
      if (els.removeMediaBtn) els.removeMediaBtn.style.display = 'none';
      setAddTextButtonState(false);
      setEditMediaButtonState(false);
      setReturnToEditorButtonState(false);
      
      els.uploadPlaceholder.style.display = '';
      els.uploadZone.querySelectorAll('video').forEach(v => v.remove());
      
      uploadedFile = null;
      userSelectedThumbnail = '';
      els.fileInput.value = '';
      
      if (editingPostId) {
        const post = state.posts.find(p => String(p.id) === String(editingPostId));
        if (post) {
            post.video_url = '';
            post.image_url = '';
        }
      }
      
      validateForm();
    });
  }

  // Copy to clipboard
  if (els.copyCaptionBtn) {
    els.copyCaptionBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(els.captionInput.value).then(() => showToast('Caption copied!'));
    });
  }
  if (els.copyHashtagBtn) {
    els.copyHashtagBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(els.hashtagInput.value).then(() => showToast('Hashtags copied!'));
    });
  }

  // Schedule / Update post
  els.schedulePostBtn.addEventListener('click', async () => {
    if (els.schedulePostBtn.disabled) return;
    if (uploadedFile?._uploadError) {
      await retryCurrentMediaUpload();
      return;
    }

    const supabaseUrl = uploadedFile?._supabaseUrl || '';

    // Guard: never save a post without a media URL (upload must be complete before button is enabled)
    if (!selectedType || (selectedType !== 'live' && !supabaseUrl && uploadedFile && !uploadedFile._existing)) {
      showToast('Media is still being prepared — please try again in a moment.');
      return;
    }

    const caption = els.captionInput.value.trim();
    const date = els.dateInput.value;
    const time = els.timeInput.value;
    const hashtags = els.hashtagInput.value.trim();
    const isLive = selectedType === 'live';
    const videoEl = els.uploadZone.querySelector('video');
    const isVideoFile = uploadedFile?._isVideo || false;
    const isVideo = isVideoFile || !!videoEl;

    let thumbnailUrl = userSelectedThumbnail || '';
    if (!thumbnailUrl && isVideo && videoEl && videoEl.readyState >= 2) {
      try {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 150;
        tempCanvas.height = Math.floor((videoEl.videoHeight / videoEl.videoWidth) * 150) || 150;
        if (!isFinite(tempCanvas.height) || tempCanvas.height === 0) tempCanvas.height = 150;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(videoEl, 0, 0, tempCanvas.width, tempCanvas.height);
        thumbnailUrl = tempCanvas.toDataURL('image/jpeg', 0.6);
      } catch (e) {
        console.warn('Could not auto-capture video thumbnail:', e);
      }
    }

    if (editingPostId) {
      // UPDATE existing post
      const existingPost = state.posts.find(p => String(p.id) === String(editingPostId));
      const updatedData = {
        caption,
        date,
        time: time || '09:00',
        type: selectedType,
        hashtags,
        image_url: isLive ? '' : (thumbnailUrl || supabaseUrl || existingPost?.image_url || ''),
        video_url: isLive ? '' : (isVideo ? (supabaseUrl || existingPost?.video_url || '') : ''),
        media_type: normalizeDbMediaType(selectedType, isVideo),
      };
      const updated = await updatePost(editingPostId, updatedData);
      if (!updated) {
        showToast('Could not update this post — please try again.');
        validateForm();
        return;
      }
      renderCalendar();
      renderUpcoming();
      renderActionsPage();
      renderTopPosts();
      showToast(`${(POST_TYPES[selectedType] || POST_TYPES.post).label} updated!`);
      closeModal();
      resetModalForBackToBack();
    } else {
      // CREATE new post
      const post = {
        id: state.nextId++,
        caption,
        date,
        time: time || '09:00',
        type: selectedType,
        status: 'pending',
        hashtags,
        image_url: isLive ? '' : (isVideo ? thumbnailUrl : supabaseUrl),
        video_url: isLive ? '' : (isVideo ? supabaseUrl : ''),
        media_type: normalizeDbMediaType(selectedType, isVideo),
      };

      // Insert to Supabase
      if (isSupabaseConfigured) {
        try {
          const sbPost = await insertPostToSupabase(post);
          if (!sbPost) throw new Error('The schedule save did not return a post record.');
          post.id = sbPost.id;
        } catch (e) {
          const message = e?.message || 'Supabase rejected the scheduled post.';
          showToast(`Could not schedule post: ${message}`);
          validateForm();
          return;
        }
      }

      state.posts.push(post);
      savePosts();
      renderCalendar();
      renderUpcoming();
      renderActionsPage();
      renderTopPosts();
      showToast('Post scheduled successfully!');

      // Close modal to prepare for another entry
      closeModal();
      resetModalForBackToBack();
    }
  });

  // Save draft
  els.saveDraftBtn.addEventListener('click', async () => {
    const caption = els.captionInput.value.trim() || 'Untitled draft';
    const date = els.dateInput.value || formatDate(state.today.getFullYear(), state.today.getMonth(), state.today.getDate());
    const time = els.timeInput.value || '09:00';
    const supabaseUrl = uploadedFile?._supabaseUrl || '';
    const isVideo = uploadedFile?._isVideo || false;

    const post = {
      id: state.nextId++,
      caption,
      date,
      time,
      type: selectedType,
      status: 'draft',
      hashtags: els.hashtagInput.value.trim(),
      image_url: isVideo ? '' : supabaseUrl,
      video_url: isVideo ? supabaseUrl : '',
      media_type: isVideo ? 'VIDEO' : 'IMAGE',
    };

    // Insert to Supabase
    if (isSupabaseConfigured) {
      try {
        const sbPost = await insertPostToSupabase(post);
        if (!sbPost) throw new Error('The draft save did not return a post record.');
        post.id = sbPost.id;
      } catch (e) {
        const message = e?.message || 'Supabase rejected the draft.';
        showToast(`Could not save draft: ${message}`);
        return;
      }
    }

    state.posts.push(post);
    savePosts();
    closeModal();
    renderCalendar();
    renderUpcoming();
    renderTopPosts();
    showToast('Draft saved!');
  });

  // ========== ANALYTICS — MANUAL INPUT ==========
  function renderAnalyticsCards() {
    const a = state.analytics;
    if (els.statReach) {
      els.statReach.querySelector('.stat-value').textContent = formatStatValue(a.reach);
      els.statReach.querySelector('.stat-change').textContent = a.reachChange;
    }
    if (els.statEngagement) {
      els.statEngagement.querySelector('.stat-value').textContent = a.engagement + '%';
      els.statEngagement.querySelector('.stat-change').textContent = a.engagementChange;
    }
    if (els.statFollowers) {
      els.statFollowers.querySelector('.stat-value').textContent = formatStatValue(a.followers);
      els.statFollowers.querySelector('.stat-change').textContent = a.followersChange;
    }
    if (els.statPosts) {
      const now = new Date();
      const thisMonthCount = state.posts.filter(p => {
        const d = new Date(p.date + 'T00:00:00');
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      }).length;
      els.statPosts.querySelector('.stat-value').textContent = thisMonthCount;
      els.statPosts.querySelector('.stat-change').textContent = a.postsCountChange;
    }
  }

  function formatStatValue(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num);
  }

  function attachStatCardListeners() {
    const cards = [
      { el: els.statReach, key: 'reach', changeKey: 'reachChange', prompt: 'Enter your Total Reach:' },
      { el: els.statEngagement, key: 'engagement', changeKey: 'engagementChange', prompt: 'Enter your Engagement Rate (%):' },
      { el: els.statFollowers, key: 'followers', changeKey: 'followersChange', prompt: 'Enter your Followers count:' },
      { el: els.statPosts, key: 'postsCount', changeKey: 'postsCountChange', prompt: 'Enter Posts This Month:' },
    ];

    cards.forEach(({ el, key, changeKey, prompt: p }) => {
      if (!el) return;
      el.style.cursor = 'pointer';
      el.title = 'Click to edit';
      el.addEventListener('click', () => {
        const val = window.prompt(p, state.analytics[key]);
        if (val !== null && val !== '') {
          const num = parseFloat(val);
          if (!isNaN(num)) {
            state.analytics[key] = num;
            const change = window.prompt(`Enter change indicator (e.g. +12.4% or +854):`, state.analytics[changeKey]);
            if (change !== null) state.analytics[changeKey] = change;
            saveAnalytics();
            renderAnalyticsCards();
          }
        }
      });
    });
  }

  // ========== PLANNING DENSITY CHART ==========
  function drawChart() {
    const canvas = els.engagementCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // Calculate planning density: count posts per day of the current week
    const todayDate = state.today;
    const dayOfWeek = todayDate.getDay();
    const weekStartDate = new Date(todayDate);
    weekStartDate.setDate(todayDate.getDate() - ((dayOfWeek + 6) % 7)); // Monday start

    const density = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStartDate);
      d.setDate(weekStartDate.getDate() + i);
      const dateStr = formatDate(d.getFullYear(), d.getMonth(), d.getDate());
      const count = getPostsByDate(dateStr).length;
      density.push(count);
    }

    const maxVal = Math.max(...density, 1) * 1.4;
    const padding = { top: 20, right: 20, bottom: 35, left: 50 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const gridSteps = Math.max(Math.ceil(maxVal), 4);
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '10px Inter';
      ctx.textAlign = 'right';
      const label = Math.round(maxVal - (maxVal / 4) * i);
      ctx.fillText(String(label), padding.left - 8, y + 3);
    }

    // Day labels
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '11px Inter';
    ctx.textAlign = 'center';
    days.forEach((d, i) => {
      const x = padding.left + (chartW / (days.length - 1)) * i;
      ctx.fillText(d, x, h - 8);
    });

    // Draw bars for density
    const barWidth = chartW / days.length * 0.6;
    density.forEach((val, i) => {
      const x = padding.left + (chartW / (days.length - 1)) * i - barWidth / 2;
      const barH = (val / maxVal) * chartH;
      const y = padding.top + chartH - barH;

      const gradient = ctx.createLinearGradient(x, y, x, y + barH);
      gradient.addColorStop(0, '#DD2A7B');
      gradient.addColorStop(1, '#8134AF');
      ctx.fillStyle = gradient;

      const radius = 4;
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + barWidth - radius, y);
      ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
      ctx.lineTo(x + barWidth, y + barH);
      ctx.lineTo(x, y + barH);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.fill();

      // Value on top
      if (val > 0) {
        ctx.fillStyle = '#f0f0f5';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(String(val), x + barWidth / 2, y - 6);
      }
    });
  }

  // ========== TOP POSTS ==========
  function renderTopPosts() {
    if (!els.topPostsList) return;
    if (state.posts.length === 0) {
      els.topPostsList.innerHTML = '<p style="text-align:center;color:var(--text-tertiary);font-size:0.82rem;padding:20px;">No scheduled posts yet. Schedule some content to get started!</p>';
      return;
    }
    const sorted = state.posts.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    els.topPostsList.innerHTML = sorted.map(p => {
      const typeConf = POST_TYPES[p.type] || POST_TYPES.post;
      let thumbHtml;
      if (p.image_url) {
        thumbHtml = `<img src="${p.image_url}" alt="" loading="lazy">`;
      } else {
        thumbHtml = typeConf.icon;
      }
      const statusStr = getStatusClass(p.status);
      const statusLabel = getStatusLabel(p.status);
      return `
      <div class="top-post-item" data-post-id="${p.id}">
        <button class="item-delete-btn" data-delete-id="${p.id}" title="Delete post">×</button>
        <div class="top-post-thumb" style="border-left: 3px solid ${typeConf.color};">${thumbHtml}</div>
        <div class="top-post-info">
          <div class="top-post-caption">${escapeHtml(p.caption || 'Untitled')}</div>
          <div class="top-post-date">${formatDisplayDate(p.date)} · ${formatTime12(p.time)} · ${typeConf.label}</div>
        </div>
        <span class="upcoming-status status-${statusStr}">${statusLabel}</span>
      </div>`;
    }).join('');

    // Click to edit (open popup)
    els.topPostsList.querySelectorAll('.top-post-item[data-post-id]').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.item-delete-btn')) return;
        openEditModal(item.dataset.postId);
      });
    });

    // Delete button handlers
    els.topPostsList.querySelectorAll('.item-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Delete this post?')) {
          deletePost(btn.dataset.deleteId);
          renderCalendar();
          renderUpcoming();
          renderActionsPage();
          renderTopPosts();
          showToast('Post deleted.');
        }
      });
    });
  }

  // ========== TOAST ==========
  function showToast(message) {
    els.toastMessage.textContent = message;
    els.toast.classList.add('active');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      els.toast.classList.remove('active');
    }, 3500);
  }

  // ========== UTILITIES ==========
  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  function formatDate(year, month, day) {
    const d = new Date(year, month, day);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function formatDisplayDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  }

  function formatTime12(time24) {
    const normalized = normalizePostTime(time24);
    const [h, m] = normalized.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${period}`;
  }

  function convertTo24(time12) {
    const match = time12.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return '09:00';
    let [, h, m, period] = match;
    h = parseInt(h);
    if (period.toUpperCase() === 'PM' && h !== 12) h += 12;
    if (period.toUpperCase() === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}`;
  }

  function getPostsByDate(dateStr) {
    return state.posts.filter(p => p.date === dateStr && shouldShowPostOnCalendar(p));
  }

  // ========== KEYBOARD SHORTCUTS ==========
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Close one layer at a time — modal first, then actions page
      if (els.modalOverlay.classList.contains('active')) {
        closeModal();
      } else if (els.actionsPageOverlay && els.actionsPageOverlay.classList.contains('active')) {
        closeActionsPage();
      }
      closeSidebar();
    }
  });

  // ========== RESIZE ==========
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.currentPage === 'analytics') drawChart();
      if (typeof toeSyncTrack === 'function') toeSyncTrack();
    }, 150);
  });

  // ========== INFO TOOLTIP DROPDOWNS ==========
  document.querySelectorAll('.info-tooltip-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = trigger.querySelector('.info-tooltip-dropdown');
      if (dropdown) {
        dropdown.classList.toggle('visible');
        // Close on click outside
        setTimeout(() => {
          document.addEventListener('click', function closer() {
            dropdown.classList.remove('visible');
            document.removeEventListener('click', closer);
          }, { once: true });
        }, 0);
      }
    });
  });

  // ========== CLEAN EXPIRED POSTS (DISABLED — posts persist until manually deleted) ==========
  function cleanExpiredPosts() {
    // Intentionally disabled: posts are kept indefinitely until the user deletes them.
    // No automatic cleanup.
  }

  // ========== STATUS HELPERS ==========
  // Maps internal status to display class and label
  function getStatusClass(status) {
    const s = (status || 'pending').toLowerCase();
    if (s === 'pending' || s === 'active' || s === 'scheduled') return 'active';
    if (s === 'draft') return 'draft';
    if (s === 'published') return 'published';
    if (s === 'failed') return 'failed';
    if (s === 'permanently_failed') return 'failed';
    return s;
  }

  function getStatusLabel(status) {
    const s = (status || 'pending').toLowerCase();
    if (s === 'pending' || s === 'active' || s === 'scheduled') return 'ACTIVE';
    if (s === 'draft') return 'Draft';
    if (s === 'published') return 'Published';
    if (s === 'failed') return 'Retrying';
    if (s === 'permanently_failed') return 'Failed';
    return capitalize(s);
  }

  // ========== ACTIONS PAGE ==========
  function renderActionsPageMetrics() {
    if (!els.actionsMetricsBar) return;
    const now = new Date();
    const total = state.posts.length;
    const thisMonth = state.posts.filter(p => {
      const d = new Date(p.date + 'T00:00:00');
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
    // Active = pending + active + scheduled (matches getStatusClass/getStatusLabel logic)
    const activeCount = state.posts.filter(p => {
      const s = (p.status || 'pending').toLowerCase();
      return s === 'pending' || s === 'active' || s === 'scheduled';
    }).length;
    // Drafts = only posts explicitly saved as draft
    const draftCount = state.posts.filter(p => (p.status || 'pending').toLowerCase() === 'draft').length;
    const byType = {};
    state.posts.forEach(p => { byType[p.type] = (byType[p.type] || 0) + 1; });

    const typeChips = Object.entries(byType).map(([type, count]) => {
      const conf = POST_TYPES[type] || POST_TYPES.post;
      return `<div class="actions-metric-chip${count > 0 ? ' metric-active' : ''}">
        <div class="metric-dot" style="background:${conf.color};box-shadow:0 0 6px ${conf.color}80;"></div>
        <span class="metric-value">${count}</span>
        <span class="metric-label">${conf.label}${count !== 1 ? 's' : ''}</span>
      </div>`;
    }).join('');

    els.actionsMetricsBar.innerHTML = `
      <div class="actions-metric-chip${total > 0 ? ' metric-active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14" style="color:var(--accent-instagram);flex-shrink:0;">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <span class="metric-value">${total}</span>
        <span class="metric-label">Total Scheduled</span>
      </div>
      <div class="actions-metric-chip${thisMonth > 0 ? ' metric-active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14" style="color:var(--accent-orange);flex-shrink:0;">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span class="metric-value">${thisMonth}</span>
        <span class="metric-label">This Month</span>
      </div>
      <div class="actions-metric-chip${activeCount > 0 ? ' metric-active' : ''}">
        <div class="metric-dot" style="background:var(--success);box-shadow:0 0 6px rgba(52,211,153,0.6);"></div>
        <span class="metric-value">${activeCount}</span>
        <span class="metric-label">Active</span>
      </div>
      <div class="actions-metric-chip${draftCount > 0 ? ' metric-active' : ''}">
        <div class="metric-dot" style="background:var(--accent-orange);box-shadow:0 0 6px rgba(245,133,41,0.6);"></div>
        <span class="metric-value">${draftCount}</span>
        <span class="metric-label">Drafts</span>
      </div>
      ${typeChips}
    `;
  }

  function renderActionsPage() {
    if (!els.actionsPageBody) return;
    renderActionsPageMetrics();

    const sorted = [...state.posts].sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return (a.time || '').localeCompare(b.time || '');
    });

    if (sorted.length === 0) {
      els.actionsPageBody.innerHTML = '<div class="actions-empty">No scheduled actions yet. Create posts from the calendar to see them here.</div>';
      return;
    }

    // Group by month
    const groups = {};
    sorted.forEach(p => {
      const d = new Date(p.date + 'T00:00:00');
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
      if (!groups[monthKey]) groups[monthKey] = { label: monthLabel, posts: [] };
      groups[monthKey].posts.push(p);
    });

    let html = '';
    Object.keys(groups).sort().forEach(key => {
      const group = groups[key];
      html += `<div class="actions-month-group">`;
      html += `<div class="actions-month-header">${group.label}</div>`;
      group.posts.forEach(p => {
        const typeConf = POST_TYPES[p.type] || POST_TYPES.post;
        const d = new Date(p.date + 'T00:00:00');
        const dayName = DAY_NAMES[d.getDay()];
        const displayDate = `${dayName}, ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;

        // Media thumbnail
        let mediaHtml = '';
        if (p.image_url) {
          mediaHtml = `<img src="${p.image_url}" alt="media" loading="lazy">`;
        } else if (p.video_url) {
          mediaHtml = `<video src="${p.video_url}" controls muted playsinline></video>`;
        } else {
          mediaHtml = typeConf.icon;
        }

        const statusStr = getStatusClass(p.status);
        const statusLabel = getStatusLabel(p.status);
        html += `
        <div class="actions-entry" data-post-id="${p.id}">
          <button class="item-delete-btn" data-delete-id="${p.id}" title="Delete post">×</button>
          <div class="actions-entry-color" style="background:${typeConf.color};box-shadow:0 0 6px ${typeConf.color}40;"></div>
          <div class="actions-entry-media">${mediaHtml}</div>
          <div class="actions-entry-info">
            <div class="actions-entry-caption">${escapeHtml(p.caption || 'Untitled')}</div>
            <div class="actions-entry-meta">
              <span>${displayDate}</span>
              <span>·</span>
              <span>${formatTime12(p.time)}</span>
              <span class="actions-entry-type-badge" style="background:${typeConf.color}22;color:${typeConf.color};">${typeConf.label}</span>
            </div>
          </div>
          <span class="actions-entry-status status-${statusStr}">${statusLabel}</span>
          ${p.status === 'failed' ? `<div style="width:100%;margin-top:6px;padding:6px 10px;background:rgba(231,76,60,0.12);border-left:3px solid #e74c3c;border-radius:4px;font-size:0.74rem;color:#e74c3c;line-height:1.4;">⚠️ ${escapeHtml(p.publish_error || 'Unknown error')} <span style="opacity:0.7;">· Retry ${p.retry_count || 0}/5 — retrying automatically</span></div>` : ''}
          ${p.status === 'permanently_failed' ? `<div style="width:100%;margin-top:6px;padding:6px 10px;background:rgba(192,57,43,0.15);border-left:3px solid #c0392b;border-radius:4px;font-size:0.74rem;color:#c0392b;line-height:1.4;">❌ ${escapeHtml(p.publish_error || 'Unknown error')} <span style="opacity:0.7;">· Max retries reached — delete and reschedule</span></div>` : ''}
        </div>`;
      });
      html += `</div>`;
    });

    els.actionsPageBody.innerHTML = html;

    // Attach click handlers — open edit modal IN PLACE (don't close actions page)
    els.actionsPageBody.querySelectorAll('.actions-entry[data-post-id]').forEach(entry => {
      entry.addEventListener('click', (e) => {
        if (e.target.closest('.item-delete-btn')) return;
        // Open modal on top of the actions page — NOT redirecting to calendar
        openEditModal(entry.dataset.postId);
      });
    });

    els.actionsPageBody.querySelectorAll('.item-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Delete this post?')) {
          deletePost(btn.dataset.deleteId);
          renderActionsPage();
          renderCalendar();
          renderUpcoming();
          renderTopPosts();
          showToast('Post deleted.');
        }
      });
    });
  }

  function openActionsPage() {
    renderActionsPage();
    els.actionsPageOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeActionsPage() {
    els.actionsPageOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  function initActionsPage() {
    if (els.actionsPageBtn) {
      els.actionsPageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openActionsPage();
      });
    }
    if (els.actionsPageClose) {
      els.actionsPageClose.addEventListener('click', closeActionsPage);
    }
    // Sidebar nav within actions page
    document.querySelectorAll('.actions-sidebar-nav .nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        closeActionsPage();
        navigateTo(item.dataset.page);
      });
    });
    // Sign out from actions page sidebar
    const actionsSignOut = document.getElementById('actionsSignOutBtn');
    if (actionsSignOut) {
      actionsSignOut.addEventListener('click', async (e) => {
        e.preventDefault();
        await supabase.auth.signOut();
        window.location.href = 'signin.html';
      });
    }
    if (els.actionsPageOverlay) {
      els.actionsPageOverlay.addEventListener('click', (e) => {
        if (e.target === els.actionsPageOverlay) closeActionsPage();
      });
    }
  }

  // ========== RESOURCES — ADMIN SYNC ==========
  (function initResourceCards() {
    const RKEY = 'glogic_resources_v2';
    const ICONS = {
      bolt:'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
      hashtag:'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
      video:'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
      edit:'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
      clock:'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      chart:'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
      camera:'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>',
      star:'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
      link:'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>',
      book:'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>',
    };
    function renderResources(data) {
      const g = document.getElementById('resourcesGrid');
      if (!g) return;
      if (!Array.isArray(data) || data.length !== 6) return; // never wipe static cards unless we have exactly 6
      const html = data.map(r => {
        const svg = ICONS[r.icon] || ICONS.bolt;
        const tgt = r.openNewWindow ? ' target="_blank" rel="noopener noreferrer"' : '';
        const title = String(r.title || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const desc  = String(r.desc  || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const ltext = String(r.linkText || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const link  = String(r.link  || '#');
        const from  = String(r.from  || '#DD2A7B');
        const to    = String(r.to    || '#8134AF');
        return `<div class="card resource-card">
          <div class="resource-icon" style="background:linear-gradient(135deg,${from},${to});">${svg}</div>
          <h3>${title}</h3><p>${desc}</p>
          <a href="${link}"${tgt} class="resource-link">${ltext}</a>
        </div>`;
      }).join('');
      if (html.trim()) g.innerHTML = html; // only update if output is non-empty
    }
    function loadResources() {
      try {
        const saved = JSON.parse(localStorage.getItem(RKEY));
        renderResources(saved);
      } catch(e) { /* keep static cards on any error */ }
    }
    loadResources();
    window.addEventListener('storage', e => { if (e.key === RKEY) loadResources(); });
  })();

  // ========== TODAY DAY NAME ==========
  function initTodayDayName() {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const shortDayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date();
    document.querySelectorAll('.today-day-name-common').forEach(el => {
      el.textContent = `Today · ${shortDayNames[today.getDay()]}`;
    });
  }

  // ========== FAILURE BANNER ==========
  function renderFailureBanner() {
    const failed = state.posts.filter(p => p.status === 'failed' || p.status === 'permanently_failed');
    let banner = document.getElementById('postFailureBanner');

    if (failed.length === 0) {
      if (banner) banner.remove();
      return;
    }

    const permanent = failed.filter(p => p.status === 'permanently_failed');
    const retrying = failed.filter(p => p.status === 'failed');

    let msg = '';
    if (retrying.length > 0) msg += `${retrying.length} post${retrying.length > 1 ? 's' : ''} failed — retrying automatically. `;
    if (permanent.length > 0) msg += `${permanent.length} post${permanent.length > 1 ? 's' : ''} could not be published after 5 attempts.`;

    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'postFailureBanner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:linear-gradient(90deg,#c0392b,#e74c3c);color:#fff;font-size:0.82rem;font-weight:600;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;box-shadow:0 2px 12px rgba(0,0,0,0.3);';
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.style.cssText = 'background:none;border:none;color:#fff;font-size:1.2rem;cursor:pointer;padding:0 4px;line-height:1;opacity:0.8;';
      closeBtn.onclick = () => banner.remove();
      const viewBtn = document.createElement('button');
      viewBtn.textContent = 'View Posts →';
      viewBtn.style.cssText = 'background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:#fff;font-size:0.78rem;font-weight:700;border-radius:6px;padding:4px 10px;cursor:pointer;';
      viewBtn.onclick = () => { banner.remove(); openActionsPage(); };
      const textEl = document.createElement('span');
      textEl.id = 'postFailureBannerText';
      textEl.style.flex = '1';
      const warningIcon = '⚠️ ';
      textEl.textContent = warningIcon + msg;
      banner.append(textEl, viewBtn, closeBtn);
      document.body.prepend(banner);
    } else {
      const textEl = document.getElementById('postFailureBannerText');
      if (textEl) textEl.textContent = '⚠️ ' + msg;
    }
  }

  // ========== BACKGROUND SYNC ==========
  async function syncPostsFromSupabase() {
    if (!isSupabaseConfigured) return;
    const sbPosts = await loadPostsFromSupabase();
    if (!sbPosts) return;
    state.posts = sbPosts;
    state.nextId = Math.max(0, ...sbPosts.map(p => (typeof p.id === 'number' ? p.id : 0))) + 1;
    savePosts();
    renderCalendar();
    renderUpcoming();
    renderActionsPage();
    renderTopPosts();
    renderFailureBanner();
  }

  // ========== INIT ==========
  async function init() {
    if (isSupabaseConfigured) {
      const sbPosts = await loadPostsFromSupabase();
      if (sbPosts) {
        state.posts = sbPosts;
        state.nextId = Math.max(0, ...sbPosts.map(p => (typeof p.id === 'number' ? p.id : 0))) + 1;
        savePosts();
      }
    }

    renderCalendarHeader();
    renderCalendar();
    renderBestTimes();
    initDashboardActions();
    initHowToVideo();
    cleanExpiredPosts();
    renderUpcoming();
    renderDashboard();
    renderAnalyticsCards();
    renderTopPosts();
    attachStatCardListeners();
    initActionsPage();
    initTodayDayName();
    validateForm();
    renderFailureBanner();

    // Poll Supabase every 60 seconds to sync post statuses (picks up published/failed from cron)
    setInterval(syncPostsFromSupabase, 60000);
    setTimeout(syncPostsFromSupabase, 1500);
    setTimeout(syncPostsFromSupabase, 5000);
    if (isSupabaseConfigured && supabase?.auth?.onAuthStateChange) {
      supabase.auth.onAuthStateChange(() => {
        syncPostsFromSupabase();
      });
    }
  }

  init();

})();
