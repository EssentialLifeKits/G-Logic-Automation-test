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
      }));
    } catch (e) { console.error('Supabase load exception:', e); return null; }
  }

  async function uploadMediaToSupabase(file) {
    if (!isSupabaseConfigured) return null;
    try {
      const userId = await getCurrentUserId();
      if (!userId) return null;
      const ext = file.name.split('.').pop();
      const fileName = `${userId}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
      const { data, error } = await supabase.storage
        .from('media_uploads')
        .upload(fileName, file, { cacheControl: '3600', upsert: false });
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
      if (!userId) return null;
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
      if (error) { console.error('Insert error:', error); return null; }
      return data?.[0] || null;
    } catch (e) { console.error('Insert exception:', e); return null; }
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

  // ========== STATE ==========
  const now = new Date();
  const state = {
    currentPage: 'calendar',
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
    mobileTodayBtn: $('#mobileTodayBtn'),
    bestTimesList: $('#bestTimesList'),
    upcomingList: $('#upcomingList'),
    modalOverlay: $('#modalOverlay'),
    modalClose: $('#modalClose'),
    modalTitle: $('#modalTitle'),
    uploadZone: $('#uploadZone'),
    fileInput: $('#fileInput'),
    uploadPreview: $('#uploadPreview'),
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

    // Color-coded horizontal bars — deduplicate by type (one bar per unique type)
    let barsHtml = '';
    if (posts.length > 0) {
      const uniqueTypes = [...new Set(posts.map(p => p.type))];
      const barItems = uniqueTypes.map(type => {
        const typeConf = POST_TYPES[type] || POST_TYPES.post;
        return `<div class="cal-bar cal-bar-${type}" style="background:${typeConf.color};" title="${typeConf.label}"></div>`;
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
    const todayStr = formatDate(state.today.getFullYear(), state.today.getMonth(), state.today.getDate());
    const upcoming = state.posts
      .filter(p => p.date >= todayStr)
      .sort((a, b) => new Date(a.date + 'T' + a.time) - new Date(b.date + 'T' + b.time));

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

  // ========== SCHEDULER MODAL ==========
  let selectedType = 'post';
  let uploadedFile = null;
  let editingPostId = null; // Track which post is being edited
  let userSelectedThumbnail = ''; // User's manually captured thumbnail

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
    els.uploadPlaceholder.style.display = 'none';
    els.uploadZone.querySelectorAll('video').forEach(v => v.remove());
    uploadedFile = { _existing: true }; // Mark as having existing media
    userSelectedThumbnail = '';

    if (post.video_url) {
      const videoEl = document.createElement('video');
      videoEl.src = post.video_url;
      videoEl.controls = true;
      videoEl.setAttribute('playsinline', '');
      els.uploadZone.appendChild(videoEl);
      if (els.removeMediaBtn) els.removeMediaBtn.style.display = '';
      
      videoEl.addEventListener('seeked', () => {
        if (els.captureThumbBtn) els.captureThumbBtn.style.display = '';
      });

      if (post.image_url) {
        userSelectedThumbnail = post.image_url;
        if (els.capturedThumbPreview) {
          els.capturedThumbPreview.src = userSelectedThumbnail;
          els.capturedThumbPreview.style.display = 'block';
        }
      }
    } else if (post.image_url) {
      if (els.removeMediaBtn) els.removeMediaBtn.style.display = '';
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
    if (idx === -1) return;
    Object.assign(state.posts[idx], updatedData);
    savePosts();

    // Update in Supabase if configured
    if (isSupabaseConfigured) {
      try {
        const scheduledTime = `${updatedData.date}T${updatedData.time || '09:00'}:00`;
        await supabase.from('posts').update({
          caption: updatedData.caption,
          hashtags: updatedData.hashtags || '',
          post_type: updatedData.type || 'post',
          scheduled_time: scheduledTime,
          image_url: updatedData.image_url || '',
          video_url: updatedData.video_url || '',
          media_type: updatedData.media_type || 'IMAGE',
        }).eq('id', postId);
      } catch (e) { console.error('Update error:', e); }
    }
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
  function validateForm() {
    const isLive = selectedType === 'live';
    const hasMedia = isLive || !!uploadedFile;
    const hasCaption = els.captionInput.value.trim().length > 0;
    const hasDate = !!els.dateInput.value;
    const hasTime = !!els.timeInput.value;
    const hasType = !!selectedType;
    const isValid = hasMedia && hasCaption && hasDate && hasTime && hasType;

    els.schedulePostBtn.classList.toggle('btn-disabled', !isValid);
    els.schedulePostBtn.classList.toggle('btn-glow', isValid);
    els.schedulePostBtn.disabled = !isValid;
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
    if (e.target.closest('.capture-thumb-btn')) return;
    if (e.target.closest('video')) return;
    els.fileInput.click();
  });
  els.fileInput.addEventListener('change', handleFileUpload);
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

  function handleFileUpload() {
    const file = els.fileInput.files[0];
    if (!file) return;
    uploadedFile = file;

    // Detect if the uploaded file is a video
    const isVideo = file.type.startsWith('video/');
    uploadedFile._isVideo = isVideo;

    if (isVideo) {
      // For video files, show a video element instead of an image
      const videoEl = document.createElement('video');
      videoEl.src = URL.createObjectURL(file);
      videoEl.controls = true;
      videoEl.muted = true;
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
      if (els.captureThumbBtn) els.captureThumbBtn.style.display = 'none';
      
      videoEl.addEventListener('seeked', () => {
        if (els.captureThumbBtn) els.captureThumbBtn.style.display = '';
      });
      
      validateForm();
    } else {
      // For images, use the existing preview
      els.uploadZone.querySelectorAll('video').forEach(v => v.remove());
      if (els.captureThumbBtn) els.captureThumbBtn.style.display = 'none';
      if (els.capturedThumbPreview) els.capturedThumbPreview.style.display = 'none';
      if (els.removeMediaBtn) els.removeMediaBtn.style.display = '';
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

    // Upload to Supabase Storage in the background
    if (isSupabaseConfigured) {
      uploadedFile._uploadPromise = uploadMediaToSupabase(file).then(url => {
        if (url) {
          uploadedFile._supabaseUrl = url;
        }
        return url;
      });
    }
  }

  // Handle Thumbnail Capture Button
  if (els.captureThumbBtn) {
    els.captureThumbBtn.addEventListener('click', (e) => {
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
        if (isOriginalVertical) {
          tempCanvas.width = 1080;
          tempCanvas.height = Math.floor((videoEl.videoHeight / videoEl.videoWidth) * 1080);
        } else {
          tempCanvas.height = 1080;
          tempCanvas.width = Math.floor((videoEl.videoWidth / videoEl.videoHeight) * 1080);
        }
        
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(videoEl, 0, 0, tempCanvas.width, tempCanvas.height);
        
        userSelectedThumbnail = tempCanvas.toDataURL('image/jpeg', 0.8);
        
        if (els.capturedThumbPreview) {
          els.capturedThumbPreview.src = userSelectedThumbnail;
          els.capturedThumbPreview.style.display = 'block';
        }
        showToast('Thumbnail captured!');
      } catch (err) {
        console.warn('Could not capture video thumbnail:', err);
        showToast('Error capturing thumbnail');
      }
    });
  }

  // Remove Media Button logic
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

    let supabaseUrl = uploadedFile?._supabaseUrl || '';
    if (uploadedFile && uploadedFile._uploadPromise && !supabaseUrl) {
      els.schedulePostBtn.innerHTML = '<span style="display:inline-block;margin-right:8px;font-size:0.9em;">⏳</span> Uploading...';
      els.schedulePostBtn.disabled = true;
      try {
        supabaseUrl = await uploadedFile._uploadPromise;
      } catch (e) {
        console.error('Upload failed before saving post', e);
      }
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
        media_type: isLive ? 'NONE' : (isVideo ? 'VIDEO' : 'IMAGE'),
      };
      await updatePost(editingPostId, updatedData);
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
        media_type: isLive ? 'NONE' : (isVideo ? 'VIDEO' : 'IMAGE'),
      };

      // Insert to Supabase
      if (isSupabaseConfigured) {
        const sbPost = await insertPostToSupabase(post);
        if (sbPost) {
          post.id = sbPost.id;
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
      const sbPost = await insertPostToSupabase(post);
      if (sbPost) {
        post.id = sbPost.id;
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
    const [h, m] = time24.split(':').map(Number);
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
    return state.posts.filter(p => p.date === dateStr);
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
    if (s === 'pending' || s === 'active' || s === 'scheduled') return 'active'; // Scheduled posts -> ACTIVE (green glow)
    if (s === 'draft') return 'draft';         // Only Save Draft -> Draft (amber glow)
    if (s === 'published') return 'published';
    return s;
  }

  function getStatusLabel(status) {
    const s = (status || 'pending').toLowerCase();
    if (s === 'pending' || s === 'active' || s === 'scheduled') return 'ACTIVE'; // Scheduled posts display as "ACTIVE"
    if (s === 'draft') return 'Draft';         // Only drafts display as "Draft"
    if (s === 'published') return 'Published';
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

  // ========== TODAY DAY NAME ==========
  function initTodayDayName() {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const shortDayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date();
    document.querySelectorAll('.today-day-name-common').forEach(el => {
      el.textContent = `Today · ${shortDayNames[today.getDay()]}`;
    });
  }

  // ========== INIT ==========
  async function init() {
    // Try to load posts from Supabase first
    if (isSupabaseConfigured) {
      const sbPosts = await loadPostsFromSupabase();
      if (sbPosts && sbPosts.length > 0) {
        // Only override localStorage when Supabase actually has posts
        state.posts = sbPosts;
        state.nextId = Math.max(...sbPosts.map(p => (typeof p.id === 'number' ? p.id : 0)), 0) + 1;
        savePosts(); // sync localStorage to match
      }
    }

    renderCalendarHeader();
    renderCalendar();
    renderBestTimes();
    cleanExpiredPosts();
    renderUpcoming();
    renderAnalyticsCards();
    renderTopPosts();
    attachStatCardListeners();
    initActionsPage();
    initTodayDayName();
    validateForm();
  }

  init();

})();
