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
    addTextBtn: $('#addTextBtn'),
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

  // ========== TEXT OVERLAY EDITOR ==========
  const TOE_FONTS = {
    classic:    { label:'Classic', family:"Inter, 'Helvetica Neue', Arial, sans-serif", cls:'toe-font-classic', category:'basic', weight:500 },
    sansMedium: { label:'TikTokSans-Medium', family:"Inter, 'Helvetica Neue', Arial, sans-serif", cls:'toe-font-modern', category:'trending', weight:600 },
    sansRegular:{ label:'TikTokSans-Regular', family:"Inter, 'Helvetica Neue', Arial, sans-serif", cls:'toe-font-modern', category:'basic', weight:400 },
    satishy:    { label:'Satishy', family:"'Dancing Script', cursive", cls:'toe-font-script', category:'trending', weight:700 },
    script:     { label:'Script', family:"'Pacifico', cursive", cls:'toe-font-script', category:'handwritten', weight:400 },
    serene:     { label:'Serene', family:"'Playfair Display', Georgia, serif", cls:'toe-font-classic', category:'basic', weight:600 },
    serif:      { label:'Serif', family:"Georgia, 'Times New Roman', serif", cls:'toe-font-classic', category:'basic', weight:600 },
    slab:       { label:'Slab', family:"'Roboto Slab', Georgia, serif", cls:'toe-font-classic', category:'retro', weight:700 },
    technic:    { label:'Technic', family:"'Oswald', Impact, sans-serif", cls:'toe-font-strong', category:'retro', weight:600 },
    telegraph:  { label:'Telegraph', family:"'Special Elite', 'Courier New', monospace", cls:'toe-font-typewriter', category:'retro', weight:400 },
    modern:     { label:'Modern', family:"'Montserrat','Helvetica Neue',sans-serif", cls:'toe-font-modern', category:'basic', weight:600 },
    strong:     { label:'Strong', family:"'Anton',Impact,sans-serif", cls:'toe-font-strong', category:'decorative', weight:400 },
    neon:       { label:'Neon', family:"'Bebas Neue',Impact,sans-serif", cls:'toe-font-neon', category:'decorative', weight:400 },
    typewriter: { label:'Typewriter', family:"'Special Elite','Courier New',monospace", cls:'toe-font-typewriter', category:'retro', weight:400 },
    marker:     { label:'Marker', family:"'Permanent Marker', cursive", cls:'toe-font-marker', category:'handwritten', weight:400 },
    caveat:     { label:'Caveat', family:"'Caveat', cursive", cls:'toe-font-script', category:'handwritten', weight:700 },
    bangers:    { label:'Bangers', family:"'Bangers', Impact, sans-serif", cls:'toe-font-comic', category:'comic', weight:400 },
    comic:      { label:'Comic', family:"'Comic Neue', 'Comic Sans MS', cursive", cls:'toe-font-comic', category:'comic', weight:700 },
    chewy:      { label:'Chewy', family:"'Chewy', cursive", cls:'toe-font-cute', category:'cute', weight:400 },
    fredoka:    { label:'Fredoka', family:"'Fredoka', Inter, sans-serif", cls:'toe-font-cute', category:'cute', weight:600 },
    lucky:      { label:'Luckiest', family:"'Luckiest Guy', Impact, sans-serif", cls:'toe-font-decorative', category:'decorative', weight:400 },
    bubbles:    { label:'Bubbles', family:"'Rubik Bubbles', cursive", cls:'toe-font-decorative', category:'decorative', weight:400 },
  };
  const TOE_FONT_CATEGORIES = [
    { key:'all', label:'All fonts' },
    { key:'trending', label:'Trending' },
    { key:'basic', label:'Basic' },
    { key:'handwritten', label:'Handwritten' },
    { key:'retro', label:'Retro' },
    { key:'comic', label:'Comic' },
    { key:'cute', label:'Cute' },
    { key:'decorative', label:'Decorative' },
  ];
  const TOE_FAVORITES_KEY = 'glogic_toe_favorite_presets';

  const TOE_PRESET_CATEGORIES = ['favorite','trending','basic','background','glow','shadow','stroke','red','blue','yellow','pink','green'];
  const TOE_PRESET_LIBRARY = {
    favorite: [
      { key:'none', label:'⊘', cls:'toe-preset-none', style:{} },
      { key:'outline', cls:'toe-preset-s-outline', style:{ color:'#ffffff', bg:'none', shadow:'1px 1px 0 #111' } },
      { key:'pop', cls:'toe-preset-s-pop', style:{ color:'#facc15', bg:'none', shadow:'2px 2px 0 #ef4444' } },
      { key:'blue', cls:'toe-preset-s-blue', style:{ color:'#93c5fd', bg:'none', shadow:'0 0 8px #38bdf8' } },
      { key:'black', cls:'toe-preset-s-black', style:{ color:'#ffffff', bg:'solid' } },
      { key:'pink', cls:'toe-preset-s-pink', style:{ color:'#f0abfc', bg:'none', shadow:'0 2px 0 #2563eb' } },
      { key:'green', cls:'toe-preset-s-green', style:{ color:'#bbf7d0', bg:'none', shadow:'0 0 8px #22c55e' } },
      { key:'yellow', cls:'toe-preset-s-yellow', style:{ color:'#111111', bg:'semi' } },
    ],
    trending: [
      { key:'none', label:'⊘', cls:'toe-preset-none', style:{} },
      { key:'outline', cls:'toe-preset-s-outline', style:{ color:'#ffffff', bg:'none', shadow:'1px 1px 0 #111' } },
      { key:'pop', cls:'toe-preset-s-pop', style:{ color:'#facc15', bg:'none', shadow:'2px 2px 0 #ef4444' } },
      { key:'red', cls:'toe-preset-s-red', style:{ color:'#ffffff', bg:'none', shadow:'0 0 8px #ef4444' } },
      { key:'purple', cls:'toe-preset-s-purple', style:{ color:'#ffffff', bg:'none', shadow:'2px 2px 0 #312e81' } },
      { key:'soft', cls:'toe-preset-s-soft', style:{ color:'#ffffff', bg:'none', shadow:'0 2px 0 #999' } },
      { key:'yellow', cls:'toe-preset-s-yellow', style:{ color:'#111111', bg:'semi' } },
      { key:'neon', cls:'toe-preset-s-neon', style:{ color:'#ffffff', bg:'none', font:'neon', shadow:'0 0 12px #fb7185' } },
      { key:'blue', cls:'toe-preset-s-blue', style:{ color:'#93c5fd', bg:'none', shadow:'0 0 8px #38bdf8' } },
      { key:'black', cls:'toe-preset-s-black', style:{ color:'#ffffff', bg:'solid' } },
      { key:'pink', cls:'toe-preset-s-pink', style:{ color:'#f0abfc', bg:'none', shadow:'0 2px 0 #2563eb' } },
      { key:'green', cls:'toe-preset-s-green', style:{ color:'#bbf7d0', bg:'none', shadow:'0 0 8px #22c55e' } },
    ],
    basic: [
      { key:'white', cls:'toe-preset-s-soft', style:{ color:'#ffffff', bg:'none', shadow:'0 1px 2px rgba(0,0,0,.45)' } },
      { key:'black', cls:'toe-preset-s-black', style:{ color:'#ffffff', bg:'solid' } },
      { key:'bold', cls:'toe-preset-s-outline', style:{ color:'#ffffff', bg:'none', font:'strong' } },
      { key:'serif', cls:'toe-preset-s-purple', style:{ color:'#ffffff', bg:'none', font:'classic' } },
      { key:'type', cls:'toe-preset-s-yellow', style:{ color:'#111111', bg:'semi', font:'typewriter' } },
      { key:'clean', cls:'toe-preset-s-outline', style:{ color:'#ffffff', bg:'none', font:'modern' } },
    ],
    background: [
      { key:'dark', cls:'toe-preset-s-black', style:{ color:'#ffffff', bg:'solid' } },
      { key:'semi', cls:'toe-preset-s-outline', style:{ color:'#ffffff', bg:'semi' } },
      { key:'gold', cls:'toe-preset-s-yellow', style:{ color:'#111111', bg:'semi' } },
      { key:'pink-bg', cls:'toe-preset-s-pink', style:{ color:'#ffffff', bg:'semi', shadow:'0 0 8px #ec4899' } },
      { key:'blue-bg', cls:'toe-preset-s-blue', style:{ color:'#ffffff', bg:'semi', shadow:'0 0 8px #2563eb' } },
      { key:'green-bg', cls:'toe-preset-s-green', style:{ color:'#ffffff', bg:'semi', shadow:'0 0 8px #22c55e' } },
    ],
    glow: [
      { key:'rose', cls:'toe-preset-s-neon', style:{ color:'#ffffff', bg:'none', font:'neon', shadow:'0 0 14px #fb7185' } },
      { key:'cyan', cls:'toe-preset-s-blue', style:{ color:'#e0f2fe', bg:'none', font:'neon', shadow:'0 0 14px #06b6d4' } },
      { key:'lime', cls:'toe-preset-s-green', style:{ color:'#ecfccb', bg:'none', font:'neon', shadow:'0 0 14px #84cc16' } },
      { key:'violet', cls:'toe-preset-s-pink', style:{ color:'#f5d0fe', bg:'none', font:'neon', shadow:'0 0 14px #a855f7' } },
    ],
    shadow: [
      { key:'dark-shadow', cls:'toe-preset-s-outline', style:{ color:'#ffffff', bg:'none', shadow:'3px 3px 0 #111' } },
      { key:'red-shadow', cls:'toe-preset-s-red', style:{ color:'#ffffff', bg:'none', shadow:'3px 3px 0 #dc2626' } },
      { key:'blue-shadow', cls:'toe-preset-s-blue', style:{ color:'#ffffff', bg:'none', shadow:'3px 3px 0 #2563eb' } },
      { key:'pink-shadow', cls:'toe-preset-s-pink', style:{ color:'#ffffff', bg:'none', shadow:'3px 3px 0 #db2777' } },
    ],
    stroke: [
      { key:'black-stroke', cls:'toe-preset-s-outline', style:{ color:'#ffffff', bg:'none', stroke:'#111111' } },
      { key:'red-stroke', cls:'toe-preset-s-red', style:{ color:'#ffffff', bg:'none', stroke:'#ef4444' } },
      { key:'blue-stroke', cls:'toe-preset-s-blue', style:{ color:'#ffffff', bg:'none', stroke:'#2563eb' } },
      { key:'purple-stroke', cls:'toe-preset-s-purple', style:{ color:'#ffffff', bg:'none', stroke:'#7c3aed' } },
    ],
    red: [
      { key:'red-1', cls:'toe-preset-s-red', style:{ color:'#ef4444', bg:'none', shadow:'0 1px 0 #111' } },
      { key:'red-2', cls:'toe-preset-s-red', style:{ color:'#ffffff', bg:'semi', shadow:'0 0 8px #ef4444' } },
      { key:'red-3', cls:'toe-preset-s-red', style:{ color:'#fecaca', bg:'none', font:'neon', shadow:'0 0 14px #dc2626' } },
    ],
    blue: [
      { key:'blue-1', cls:'toe-preset-s-blue', style:{ color:'#3b82f6', bg:'none', shadow:'0 1px 0 #111' } },
      { key:'blue-2', cls:'toe-preset-s-blue', style:{ color:'#dbeafe', bg:'semi', shadow:'0 0 8px #2563eb' } },
      { key:'blue-3', cls:'toe-preset-s-blue', style:{ color:'#bae6fd', bg:'none', font:'neon', shadow:'0 0 14px #0284c7' } },
    ],
    yellow: [
      { key:'yellow-1', cls:'toe-preset-s-yellow', style:{ color:'#111111', bg:'semi' } },
      { key:'yellow-2', cls:'toe-preset-s-pop', style:{ color:'#facc15', bg:'none', shadow:'2px 2px 0 #111' } },
      { key:'yellow-3', cls:'toe-preset-s-yellow', style:{ color:'#fef3c7', bg:'none', font:'neon', shadow:'0 0 12px #f59e0b' } },
    ],
    pink: [
      { key:'pink-1', cls:'toe-preset-s-pink', style:{ color:'#ec4899', bg:'none', shadow:'0 1px 0 #111' } },
      { key:'pink-2', cls:'toe-preset-s-pink', style:{ color:'#fce7f3', bg:'semi', shadow:'0 0 8px #db2777' } },
      { key:'pink-3', cls:'toe-preset-s-pink', style:{ color:'#f5d0fe', bg:'none', font:'neon', shadow:'0 0 14px #d946ef' } },
    ],
    green: [
      { key:'green-1', cls:'toe-preset-s-green', style:{ color:'#22c55e', bg:'none', shadow:'0 1px 0 #111' } },
      { key:'green-2', cls:'toe-preset-s-green', style:{ color:'#dcfce7', bg:'semi', shadow:'0 0 8px #16a34a' } },
      { key:'green-3', cls:'toe-preset-s-green', style:{ color:'#bbf7d0', bg:'none', font:'neon', shadow:'0 0 14px #22c55e' } },
    ],
  };

  let toeTextElements = [];   // { id, text, font, color, size, bg, align, x, y }
  let toeActiveId = null;
  let toeFont = 'classic';
  let toeColor = '#ffffff';
  let toeSize = 32;
  let toeBg = 'none';         // none | semi | solid
  let toeAlign = 'center';
  let toeSourceMedia = null;  // the img or video element in the stage
  let toeDragState = null;
  let toePresetCategory = 'trending';
  let toeStyleTarget = 'fill';
  let toeRenderedPresets = new Map();

  const toeOverlay    = document.getElementById('toeOverlay');
  const toeStage      = document.getElementById('toeStage');
  const toeTextLayer  = document.getElementById('toeTextLayer');
  const toeCanvas     = document.getElementById('toeCanvas');
  const toeProcessing = document.getElementById('toeProcessing');
  const toeProcLabel  = document.getElementById('toeProcessingLabel');
  const toeCenterGuides = document.getElementById('toeCenterGuides');

  function toeRemoveLegacyEditors() {
    [
      'textOverlayEditor',
      'textOverlayModal',
      'textEditorOverlay',
      'textOverlayPage',
      'legacyTextOverlay',
      'overlayTextEditor',
      'textEditorModal'
    ].forEach(id => {
      const node = document.getElementById(id);
      if (node) node.remove();
    });
    document
      .querySelectorAll('.text-overlay-editor, .text-overlay-modal, .legacy-text-overlay, .text-editor-overlay')
      .forEach(node => node.remove());
  }

  toeRemoveLegacyEditors();

  function toeGetEl(id) { return document.getElementById('toe-el-' + id); }
  function toeGetActiveItem() { return toeTextElements.find(t => t.id === toeActiveId); }

  function toeTransformText(text = '', caseMode = 'normal') {
    if (caseMode === 'upper') return text.toUpperCase();
    if (caseMode === 'lower') return text.toLowerCase();
    if (caseMode === 'title') {
      return text.toLowerCase().replace(/\b([a-z])/g, char => char.toUpperCase());
    }
    return text;
  }

  function toeSetCenterGuides(showX = false, showY = false) {
    if (!toeCenterGuides) return;
    toeCenterGuides.classList.toggle('show-x', showX);
    toeCenterGuides.classList.toggle('show-y', showY);
  }

  function toeSetTheme(theme) {
    if (!toeOverlay) return;
    toeOverlay.classList.remove('theme-light');
    toeOverlay.classList.add('theme-brand');
  }

  function toeGetSavedTheme() {
    return 'brand';
  }

  function toeRenderFontOptions() {
    const fontSelect = document.getElementById('toeFontSelect');
    if (!fontSelect) return;
    const keys = Object.keys(TOE_FONTS);
    if (!keys.includes(toeFont)) toeFont = keys[0] || 'classic';
    fontSelect.innerHTML = TOE_FONT_CATEGORIES.map(category => {
      const categoryKeys = category.key === 'all'
        ? keys
        : keys.filter(key => TOE_FONTS[key].category === category.key);
      if (!categoryKeys.length) return '';
      const options = categoryKeys.map(key => {
        const font = TOE_FONTS[key];
        return `<option value="${key}" style="font-family:${font.family};font-weight:${font.weight || 500};">${font.label}</option>`;
      }).join('');
      return `<optgroup label="${category.label}">${options}</optgroup>`;
    }).join('');
    fontSelect.value = toeFont;
  }

  function toeLoadFavoritePresets() {
    try {
      const saved = JSON.parse(localStorage.getItem(TOE_FAVORITES_KEY) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch (_) {
      return [];
    }
  }

  function toeSaveFavoritePresets(items) {
    try { localStorage.setItem(TOE_FAVORITES_KEY, JSON.stringify(items.slice(0, 40))); }
    catch (_) {}
  }

  function toePresetFavoriteId(category, preset) {
    return preset.favoriteId || `${category}:${preset.originalKey || preset.key}`;
  }

  function toeIsFavoritePreset(category, preset) {
    const id = toePresetFavoriteId(category, preset);
    return toeLoadFavoritePresets().some(item => item.favoriteId === id);
  }

  function toeToggleFavoritePreset(renderedKey) {
    const preset = toeRenderedPresets.get(renderedKey);
    if (!preset || preset.key === 'none') return;
    const favoriteId = toePresetFavoriteId(preset.sourceCategory || toePresetCategory, preset);
    const saved = toeLoadFavoritePresets();
    const exists = saved.some(item => item.favoriteId === favoriteId);
    const next = exists
      ? saved.filter(item => item.favoriteId !== favoriteId)
      : [{ ...preset, key: preset.originalKey || preset.key, favoriteId, sourceCategory: preset.sourceCategory || toePresetCategory }, ...saved];
    toeSaveFavoritePresets(next);
    toeRenderPresetGrids();
  }

  function toeApplyStyle(el, item) {
    if (!el) return;
    const fontConf = TOE_FONTS[item.font] || TOE_FONTS.modern;
    el.style.fontFamily = fontConf.family;
    el.style.fontWeight = fontConf.weight || 500;
    el.style.fontSize   = item.size + 'px';
    el.style.color      = item.color;
    el.style.textAlign  = item.align;
    el.style.left       = item.x + '%';
    el.style.top        = item.y + '%';
    el.style.textShadow = item.shadow || '';
    el.style.webkitTextStroke = item.stroke ? `1px ${item.stroke}` : '';
    el.style.opacity = item.opacity == null ? '1' : String(item.opacity);
    el.style.lineHeight = String(1 + ((item.lineHeight ?? 20) / 100));
    el.style.letterSpacing = `${((item.letterSpacing ?? 0) / 100) * item.size}px`;
    // Background
    el.classList.remove('toe-bg-none','toe-bg-semi','toe-bg-solid');
    el.classList.add('toe-bg-' + (item.bg || 'none'));
    if (item.bg === 'none') {
      el.style.background = 'transparent';
    } else if (item.bgColor) {
      el.style.background = item.bg === 'semi' ? toeHexToRgba(item.bgColor, 0.62) : item.bgColor;
    } else {
      el.style.background = '';
    }
    // Font class
    Object.values(TOE_FONTS).forEach(f => el.classList.remove(f.cls));
    el.classList.add(fontConf.cls);
  }

  function toeRenderAll() {
    toeTextLayer.innerHTML = '';
    toeTextElements.forEach(item => {
      const wrap = document.createElement('div');
      wrap.className = 'toe-text-el' + (item.id === toeActiveId ? ' active-text' : '');
      wrap.id = 'toe-el-' + item.id;
      wrap.contentEditable = 'true';
      wrap.textContent = toeTransformText(item.text, item.caseMode);
      wrap.draggable = false;
      toeApplyStyle(wrap, item);

      // Delete button
      const del = document.createElement('button');
      del.className = 'toe-delete-btn';
      del.innerHTML = '×';
      del.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        toeTextElements = toeTextElements.filter(t => t.id !== item.id);
        if (toeActiveId === item.id) toeActiveId = null;
        toeRenderAll();
      });
      wrap.appendChild(del);

      // Click to activate
      wrap.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('toe-delete-btn')) return;
        e.preventDefault();
        toeActiveId = item.id;
        toeRenderAll();
        toeUpdateToolbarToActive();
        // Begin drag
        const startX = e.clientX;
        const startY = e.clientY;
        const startPX = item.x;
        const startPY = item.y;
        const rect = toeStage.getBoundingClientRect();
        toeSetCenterGuides(Math.abs(item.y - 50) <= 1, Math.abs(item.x - 50) <= 1);
        const onMove = (mv) => {
          const dx = ((mv.clientX - startX) / rect.width)  * 100;
          const dy = ((mv.clientY - startY) / rect.height) * 100;
          let nextX = Math.max(5, Math.min(95, startPX + dx));
          let nextY = Math.max(5, Math.min(95, startPY + dy));
          const nearX = Math.abs(nextX - 50) <= 2;
          const nearY = Math.abs(nextY - 50) <= 2;
          if (nearX) nextX = 50;
          if (nearY) nextY = 50;
          item.x = nextX;
          item.y = nextY;
          toeSetCenterGuides(nearY, nearX);
          const el2 = toeGetEl(item.id);
          if (el2) { el2.style.left = item.x + '%'; el2.style.top = item.y + '%'; }
        };
        const onUp = () => {
          toeSetCenterGuides(Math.abs(item.y - 50) <= 1, Math.abs(item.x - 50) <= 1);
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          window.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        window.addEventListener('mouseup', onUp);
      });

      // Save text on input
      wrap.addEventListener('input', () => {
        item.text = wrap.innerText;
        const inspector = document.getElementById('toeInspectorText');
        if (toeActiveId === item.id && inspector && inspector.value !== item.text) inspector.value = item.text;
      });

      toeTextLayer.appendChild(wrap);
    });
  }

  function toeUpdateToolbarToActive() {
    const item = toeGetActiveItem();
    if (!item) return;
    toeFont  = item.font;
    toeColor = item.color;
    toeSize  = item.size;
    toeBg    = item.bg;
    toeAlign = item.align;
    // Update UI
    toeRenderFontOptions();
    document.querySelectorAll('.toe-color-swatch').forEach(b => b.classList.toggle('active', b.dataset.color === toeColor));
    document.querySelectorAll('.toe-align-btn').forEach(b => b.classList.toggle('active', b.dataset.align === toeAlign));
    const sizeSlider = document.getElementById('toeSizeSlider');
    const sizeSelect = document.getElementById('toeSizeSelect');
    const inspector = document.getElementById('toeInspectorText');
    const opacityRange = document.querySelector('.toe-opacity-row input');
    const opacityLabel = document.querySelector('.toe-opacity-row span');
    const lineSlider = document.getElementById('toeLineHeightSlider');
    const lineValue = document.getElementById('toeLineHeightValue');
    const letterSlider = document.getElementById('toeLetterSpacingSlider');
    const letterValue = document.getElementById('toeLetterSpacingValue');
    if (sizeSlider) sizeSlider.value = toeSize;
    if (sizeSelect) sizeSelect.value = String(toeSize);
    if (inspector && inspector.value !== item.text) inspector.value = item.text;
    if (opacityRange) opacityRange.value = Math.round((item.opacity == null ? 1 : item.opacity) * 100);
    if (opacityLabel) opacityLabel.textContent = `${Math.round((item.opacity == null ? 1 : item.opacity) * 100)}%`;
    if (lineSlider) lineSlider.value = item.lineHeight ?? 20;
    if (lineValue) lineValue.value = item.lineHeight ?? 20;
    if (letterSlider) letterSlider.value = item.letterSpacing ?? 0;
    if (letterValue) letterValue.value = item.letterSpacing ?? 0;
    document.querySelectorAll('[data-case-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.caseMode === (item.caseMode || 'normal'));
    });
    toeUpdateStylePreviewButtons(item);
  }

  function toeAddTextElement() {
    const id = Date.now();
    toeTextElements.push({
      id,
      text: 'Text',
      font: toeFont,
      color: toeColor,
      size: toeSize,
      bg: toeBg,
      align: toeAlign,
      x: 50,
      y: 12,
      lineHeight: 20,
      letterSpacing: 0,
      caseMode: 'normal'
    });
    toeActiveId = id;
    toeRenderAll();
    toeUpdateToolbarToActive();
    // Focus for editing
    setTimeout(() => {
      const el = toeGetEl(id);
      if (el) { el.focus(); document.execCommand('selectAll', false, null); }
    }, 50);
  }

  function toeUpdateActive(prop, val) {
    const item = toeGetActiveItem();
    if (!item) return;
    item[prop] = val;
    toeApplyStyle(toeGetEl(item.id), item);
  }

  function toeApplyPreset(preset) {
    if (!preset) return;
    let item = toeGetActiveItem();
    if (!item) {
      toeAddTextElement();
      item = toeGetActiveItem();
    }
    if (!item) return;
    if (preset.key === 'none') {
      Object.assign(item, { color:'#ffffff', bg:'none', bgColor:'', shadow:'', shadowColor:'', stroke:'', font:'classic' });
    } else {
      Object.assign(item, preset.style || {});
    }
    toeFont = item.font || toeFont;
    toeColor = item.color || toeColor;
    toeBg = item.bg || toeBg;
    toeRenderAll();
    toeUpdateToolbarToActive();
  }

  function toePresetTileMarkup(preset, renderedKey) {
    const label = preset.label || 'ART';
    const isFavorite = preset.key !== 'none' && toeIsFavoritePreset(preset.sourceCategory || toePresetCategory, preset);
    const star = isFavorite ? '★' : '☆';
    const favoriteClass = isFavorite ? ' is-favorite' : '';
    return `<button class="toe-preset-tile ${preset.cls || ''}" type="button" data-preset-key="${renderedKey}">
      <span class="toe-preset-word">${label}</span>
      ${preset.key === 'none' ? '' : `<span class="toe-preset-star${favoriteClass}" data-favorite-preset="${renderedKey}" data-tooltip="${isFavorite ? 'Remove favorite' : 'Add favorite'}">${star}</span>`}
    </button>`;
  }

  function toeRenderPresetGrids() {
    toeRenderedPresets = new Map();
    const basePresets = toePresetCategory === 'favorite'
      ? toeLoadFavoritePresets()
      : (TOE_PRESET_LIBRARY[toePresetCategory] || TOE_PRESET_LIBRARY.trending);
    const presets = toePresetCategory === 'favorite'
      ? basePresets
      : Array.from({ length: 5 }).flatMap(() => basePresets).slice(0, 60);
    const html = presets.length
      ? presets.map((preset, index) => {
          const originalKey = preset.originalKey || preset.key;
          const sourceCategory = preset.sourceCategory || toePresetCategory;
          const renderedKey = `${sourceCategory}:${originalKey}:${index}`;
          const renderedPreset = { ...preset, key: originalKey, originalKey, sourceCategory };
          toeRenderedPresets.set(renderedKey, renderedPreset);
          return toePresetTileMarkup(renderedPreset, renderedKey);
        }).join('')
      : '<div class="toe-empty-favorites">Tap a star on any preset to save it here.</div>';
    const left = document.getElementById('toeLeftPresetGrid');
    const right = document.getElementById('toeRightPresetGrid');
    if (left) left.innerHTML = html;
    if (right) right.innerHTML = html;
    document.querySelectorAll('.toe-preset-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.preset === toePresetCategory);
    });
  }

  function toeFindPresetByRenderedKey(renderedKey) {
    return toeRenderedPresets.get(renderedKey);
  }

  function toeSetRightPane(name) {
    document.querySelectorAll('.toe-right-pane').forEach(pane => {
      pane.classList.toggle('active', pane.dataset.pane === name);
    });
    document.querySelectorAll('.toe-inspector-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.paneTarget === name);
    });
  }

  function toeRenderTimelineThumbs(mediaEl) {
    const track = document.getElementById('toeTimelineThumbs');
    if (!track) return;
    const isVid = mediaEl?.tagName === 'VIDEO';
    const source = !isVid ? mediaEl?.src : '';
    track.innerHTML = Array.from({ length: 24 }).map(() => {
      const style = source ? ` style="background-image:url('${source.replace(/'/g, "\\'")}')"` : '';
      return `<span class="toe-media-thumb${isVid ? ' is-video' : ''}"${style}></span>`;
    }).join('');
  }

  function toeOpen(mediaFile) {
    toeRemoveLegacyEditors();
    // Clear previous state
    toeTextElements = [];
    toeActiveId = null;
    toeFont = 'classic'; toeColor = '#ffffff'; toeSize = 32; toeBg = 'none'; toeAlign = 'center';
    toePresetCategory = 'trending';
    toeTextLayer.innerHTML = '';
    toeSetTheme(toeGetSavedTheme());

    // Remove old media from stage
    toeStage.querySelectorAll('img,video').forEach(e => e.remove());

    // Add media preview to stage
    const isVid = mediaFile.type?.startsWith('video/') || mediaFile._isVideo;
    if (isVid) {
      const vid = document.createElement('video');
      vid.src = URL.createObjectURL(mediaFile);
      vid.controls = true;
      vid.muted = true;
      vid.loop = false;
      vid.preload = 'metadata';
      vid.playsInline = true;
      vid.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
      toeStage.insertBefore(vid, toeTextLayer);
      toeSourceMedia = vid;
      toeRenderTimelineThumbs(vid);
    } else {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(mediaFile);
      img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
      toeStage.insertBefore(img, toeTextLayer);
      toeSourceMedia = img;
      toeRenderTimelineThumbs(img);
    }

    // Reset toolbar UI
    toeRenderFontOptions();
    document.querySelectorAll('.toe-color-swatch').forEach(b => b.classList.toggle('active', b.dataset.color === '#ffffff'));
    document.querySelectorAll('.toe-align-btn').forEach(b => b.classList.toggle('active', b.dataset.align === 'center'));
    const sizeSlider = document.getElementById('toeSizeSlider');
    const sizeSelect = document.getElementById('toeSizeSelect');
    const inspector = document.getElementById('toeInspectorText');
    const colorPopover = document.getElementById('toeColorPopover');
    if (sizeSlider) sizeSlider.value = 32;
    if (sizeSelect) sizeSelect.value = '32';
    if (inspector) inspector.value = 'Text';
    if (colorPopover) colorPopover.classList.remove('active');
    toeStyleTarget = 'fill';
    toeSetRightPane('basic');
    toeRenderPresetGrids();

    toeOverlay.style.display = 'flex';
    toeOverlay.style.flexDirection = 'column';

    // Auto-add first text element
    toeAddTextElement();
  }

  function toeClose() {
    toeOverlay.style.display = 'none';
    toeStage.querySelectorAll('img,video').forEach(e => { URL.revokeObjectURL(e.src); e.remove(); });
  }

  function toeHexToRgba(hex, alpha) {
    const clean = String(hex || '#000000').replace('#', '');
    const value = clean.length === 3
      ? clean.split('').map(ch => ch + ch).join('')
      : clean.padEnd(6, '0').slice(0, 6);
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function toeUpdateStylePreviewButtons(item = toeGetActiveItem()) {
    if (!item) return;
    const fillBtn = document.querySelector('[data-style-popover="fill"]');
    const strokeBtn = document.querySelector('[data-style-popover="stroke"]');
    const bgMoreBtn = document.querySelector('[data-style-popover="background"]');
    const shadowBtn = document.querySelector('[data-style-popover="shadow"]');
    if (fillBtn) {
      fillBtn.textContent = item.color && item.color !== '#ffffff' ? '' : '+';
      fillBtn.style.background = item.color && item.color !== '#ffffff' ? item.color : '';
    }
    if (strokeBtn) {
      strokeBtn.textContent = item.stroke ? '' : '+';
      strokeBtn.style.background = item.stroke || '';
    }
    if (bgMoreBtn) {
      bgMoreBtn.textContent = item.bgColor ? '' : '+';
      bgMoreBtn.style.background = item.bgColor || '';
    }
    if (shadowBtn) {
      shadowBtn.textContent = item.shadowColor ? '' : '+';
      shadowBtn.style.background = item.shadowColor || '';
    }
  }

  function toeOpenStylePicker(target) {
    toeStyleTarget = target || 'fill';
    const popover = document.getElementById('toeColorPopover');
    const title = document.getElementById('toeColorPopoverTitle');
    const hint = document.getElementById('toeColorPopoverHint');
    if (!popover) return;
    const labels = {
      fill: ['Select color', 'Fill'],
      stroke: ['Select color', 'Stroke'],
      background: ['Select color', 'Background'],
      shadow: ['Select color', 'Shadow'],
    };
    const [label, help] = labels[toeStyleTarget] || labels.fill;
    if (title) title.textContent = label;
    if (hint) hint.textContent = help;
    popover.classList.add('active');
  }

  function toeApplyStyleColor(color) {
    const item = toeGetActiveItem();
    if (!item) return;
    if (toeStyleTarget === 'stroke') {
      item.stroke = color;
    } else if (toeStyleTarget === 'background') {
      item.bg = item.bg === 'none' ? 'solid' : item.bg;
      item.bgColor = color;
      toeBg = item.bg;
    } else if (toeStyleTarget === 'shadow') {
      item.shadowColor = color;
      item.shadow = `0 4px 12px ${toeHexToRgba(color, 0.85)}`;
    } else {
      item.color = color;
      toeColor = color;
    }
    toeApplyStyle(toeGetEl(item.id), item);
    toeUpdateToolbarToActive();
  }

  function toeDrawTextItems(ctx, canvasWidth, canvasHeight) {
    toeTextElements.forEach(item => {
      const fontConf = TOE_FONTS[item.font] || TOE_FONTS.modern;
      ctx.font = `${fontConf.weight || 500} ${item.size * 2}px ${fontConf.family}`;
      ctx.textAlign = item.align === 'left' ? 'left' : item.align === 'right' ? 'right' : 'center';
      ctx.textBaseline = 'alphabetic';
      const x = (item.x / 100) * canvasWidth;
      const y = (item.y / 100) * canvasHeight;
      const lines = toeTransformText(item.text, item.caseMode).split('\n');
      const letterGap = ((item.letterSpacing ?? 0) / 100) * item.size * 2;
      const lineH = item.size * 2 * (1 + ((item.lineHeight ?? 20) / 100));
      const measureLine = (line) => {
        if (!line) return 0;
        return ctx.measureText(line).width + Math.max(0, line.length - 1) * letterGap;
      };
      const drawLine = (method, line, tx, ty) => {
        if (!letterGap) {
          ctx[method](line, tx, ty);
          return;
        }
        const total = measureLine(line);
        let cursor = item.align === 'center' ? tx - total / 2 : item.align === 'right' ? tx - total : tx;
        ctx.textAlign = 'left';
        Array.from(line).forEach(char => {
          ctx[method](char, cursor, ty);
          cursor += ctx.measureText(char).width + letterGap;
        });
        ctx.textAlign = item.align === 'left' ? 'left' : item.align === 'right' ? 'right' : 'center';
      };
      if (item.bg !== 'none') {
        ctx.fillStyle = item.bgColor
          ? (item.bg === 'semi' ? toeHexToRgba(item.bgColor, 0.62) : item.bgColor)
          : (item.bg === 'solid' ? '#000' : 'rgba(0,0,0,0.55)');
        lines.forEach((line, i) => {
          const tw = measureLine(line);
          const bx = item.align === 'center' ? x - tw / 2 - 12 : item.align === 'right' ? x - tw - 12 : x - 12;
          ctx.fillRect(bx, y + i * lineH - item.size * 2 - 4, tw + 24, lineH);
        });
      }
      if (item.font === 'neon' || item.shadow) {
        ctx.shadowColor = item.shadowColor || item.color;
        ctx.shadowBlur = item.font === 'neon' ? 20 : 12;
      } else {
        ctx.shadowBlur = 0;
      }
      if (item.stroke) {
        ctx.lineWidth = Math.max(4, item.size / 5);
        ctx.strokeStyle = item.stroke;
        lines.forEach((line, i) => drawLine('strokeText', line, x, y + i * lineH));
      }
      ctx.fillStyle = item.color;
      lines.forEach((line, i) => drawLine('fillText', line, x, y + i * lineH));
      ctx.shadowBlur = 0;
    });
  }

  // Burn text onto image → returns a Blob
  async function toeBurnImage(imgEl) {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        canvas.width  = img.naturalWidth  || img.width  || 1080;
        canvas.height = img.naturalHeight || img.height || 1350;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        toeDrawTextItems(ctx, canvas.width, canvas.height);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.92);
      };
      img.src = imgEl.src;
    });
  }

  // Burn text onto video → returns a Blob via MediaRecorder
  async function toeBurnVideo(vidEl) {
    return new Promise((resolve, reject) => {
      const start = async () => {
        vidEl.pause();
        vidEl.loop = false;
        vidEl.currentTime = 0;
        await new Promise((done) => {
          if (vidEl.readyState >= 1) done();
          else vidEl.addEventListener('loadedmetadata', done, { once: true });
        });

        const canvas = document.createElement('canvas');
        canvas.width  = vidEl.videoWidth  || 1080;
        canvas.height = vidEl.videoHeight || 1920;
        const ctx = canvas.getContext('2d');
        const stream = canvas.captureStream(30);
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
          ? 'video/webm;codecs=vp8'
          : 'video/webm';
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks = [];
        const durationMs = Number.isFinite(vidEl.duration) && vidEl.duration > 0
          ? Math.min(vidEl.duration * 1000, 120000)
          : 8000;
        let rafId = null;
        let stopTimer = null;
        let stopped = false;

        const stopRecording = () => {
          if (stopped) return;
          stopped = true;
          if (rafId) cancelAnimationFrame(rafId);
          if (stopTimer) clearTimeout(stopTimer);
          vidEl.pause();
          if (recorder.state !== 'inactive') recorder.stop();
        };

        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onerror = (event) => reject(event.error || new Error('Video recorder failed.'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));

        const drawFrame = () => {
          ctx.drawImage(vidEl, 0, 0, canvas.width, canvas.height);
          toeDrawTextItems(ctx, canvas.width, canvas.height);
          if (Number.isFinite(vidEl.duration) && vidEl.currentTime >= vidEl.duration - 0.05) {
            stopRecording();
            return;
          }
          if (!vidEl.paused && !vidEl.ended && !stopped) rafId = requestAnimationFrame(drawFrame);
        };

        vidEl.onended = stopRecording;
        recorder.start();
        stopTimer = setTimeout(stopRecording, durationMs + 1250);
        await vidEl.play();
        rafId = requestAnimationFrame(drawFrame);
      };

      start().catch(reject);
    });
  }

  // Wire up toolbar events
  toeRenderFontOptions();

  const toeFontSelect = document.getElementById('toeFontSelect');
  if (toeFontSelect) {
    toeFontSelect.addEventListener('change', () => {
      toeFont = toeFontSelect.value || 'classic';
      toeUpdateActive('font', toeFont);
    });
  }

  document.querySelectorAll('.toe-color-swatch').forEach(btn => {
    if (!btn.dataset.color) return;
    btn.addEventListener('click', () => {
      toeColor = btn.dataset.color;
      document.querySelectorAll('.toe-color-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      toeApplyStyleColor(toeColor);
    });
  });

  const toeColorPicker = document.getElementById('toeColorPicker');
  if (toeColorPicker) {
    toeColorPicker.addEventListener('input', () => {
      toeColor = toeColorPicker.value;
      document.querySelectorAll('.toe-color-swatch').forEach(b => b.classList.remove('active'));
      document.getElementById('toeColorCustom').classList.add('active');
      toeApplyStyleColor(toeColor);
    });
  }

  const toeEyedropperBtn = document.getElementById('toeEyedropperBtn');
  if (toeEyedropperBtn) {
    toeEyedropperBtn.addEventListener('click', async () => {
      if ('EyeDropper' in window) {
        try {
          const result = await new EyeDropper().open();
          if (result?.sRGBHex) {
            toeColor = result.sRGBHex;
            if (toeColorPicker) toeColorPicker.value = toeColor;
            document.querySelectorAll('.toe-color-swatch').forEach(b => b.classList.remove('active'));
            toeEyedropperBtn.classList.add('active');
            toeApplyStyleColor(toeColor);
          }
        } catch (_) {}
      } else {
        toeColorPicker?.click();
      }
    });
  }

  const toeSizeSlider = document.getElementById('toeSizeSlider');
  if (toeSizeSlider) {
    toeSizeSlider.addEventListener('input', () => {
      toeSize = parseInt(toeSizeSlider.value);
      const sizeSelect = document.getElementById('toeSizeSelect');
      if (sizeSelect) sizeSelect.value = String(toeSize);
      toeUpdateActive('size', toeSize);
    });
  }

  const toeSizeSelect = document.getElementById('toeSizeSelect');
  if (toeSizeSelect) {
    toeSizeSelect.addEventListener('change', () => {
      toeSize = parseInt(toeSizeSelect.value, 10) || 32;
      if (toeSizeSlider) toeSizeSlider.value = toeSize;
      toeUpdateActive('size', toeSize);
    });
  }

  const toeInspectorText = document.getElementById('toeInspectorText');
  if (toeInspectorText) {
    toeInspectorText.addEventListener('input', () => {
      const item = toeGetActiveItem();
      if (!item) return;
      item.text = toeInspectorText.value;
      const el = toeGetEl(item.id);
      if (el) {
        const deleteBtn = el.querySelector('.toe-delete-btn');
        el.textContent = item.text;
        if (deleteBtn) el.appendChild(deleteBtn);
      }
    });
  }

  const toeOpacityRange = document.querySelector('.toe-opacity-row input');
  const toeOpacityLabel = document.querySelector('.toe-opacity-row span');
  if (toeOpacityRange) {
    toeOpacityRange.addEventListener('input', () => {
      const value = parseInt(toeOpacityRange.value, 10);
      const opacity = Math.max(0, Math.min(1, value / 100));
      if (toeOpacityLabel) toeOpacityLabel.textContent = `${value}%`;
      toeUpdateActive('opacity', opacity);
    });
  }

  document.querySelectorAll('.toe-align-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      toeAlign = btn.dataset.align;
      document.querySelectorAll('.toe-align-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      toeUpdateActive('align', toeAlign);
    });
  });

  function toeToggleFormatPopover(popoverId) {
    const popover = document.getElementById(popoverId);
    if (!popover) return;
    document.querySelectorAll('.toe-format-popover').forEach(panel => {
      if (panel !== popover) panel.classList.remove('active');
    });
    const colorPopover = document.getElementById('toeColorPopover');
    if (colorPopover) colorPopover.classList.remove('active');
    popover.classList.toggle('active');
  }

  document.getElementById('toeCaseBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toeToggleFormatPopover('toeCasePopover');
  });

  document.getElementById('toeSpacingBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toeToggleFormatPopover('toeSpacingPopover');
  });

  document.querySelectorAll('[data-case-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      toeUpdateActive('caseMode', btn.dataset.caseMode || 'normal');
      toeRenderAll();
      toeUpdateToolbarToActive();
    });
  });

  function toeBindSpacingControl(sliderId, inputId, prop) {
    const slider = document.getElementById(sliderId);
    const input = document.getElementById(inputId);
    const update = (value) => {
      const next = Math.max(0, Math.min(prop === 'lineHeight' ? 80 : 100, parseInt(value, 10) || 0));
      if (slider) slider.value = next;
      if (input) input.value = next;
      toeUpdateActive(prop, next);
    };
    slider?.addEventListener('input', () => update(slider.value));
    input?.addEventListener('input', () => update(input.value));
  }

  toeBindSpacingControl('toeLineHeightSlider', 'toeLineHeightValue', 'lineHeight');
  toeBindSpacingControl('toeLetterSpacingSlider', 'toeLetterSpacingValue', 'letterSpacing');

  document.querySelectorAll('[data-preset-tabs]').forEach(tabGroup => {
    tabGroup.addEventListener('click', (e) => {
      const tab = e.target.closest('.toe-preset-tab');
      if (!tab) return;
      toePresetCategory = tab.dataset.preset || 'trending';
      toeRenderPresetGrids();
    });
  });

  document.querySelectorAll('.toe-preset-grid').forEach(grid => {
    grid.addEventListener('click', (e) => {
      const favoriteBtn = e.target.closest('[data-favorite-preset]');
      if (favoriteBtn) {
        e.stopPropagation();
        toeToggleFavoritePreset(favoriteBtn.dataset.favoritePreset);
        return;
      }
      const tile = e.target.closest('.toe-preset-tile');
      if (!tile) return;
      document.querySelectorAll('.toe-preset-tile').forEach(t => t.classList.remove('active'));
      tile.classList.add('active');
      toeApplyPreset(toeFindPresetByRenderedKey(tile.dataset.presetKey));
    });
  });

  document.querySelectorAll('.toe-inspector-tab').forEach(tab => {
    tab.addEventListener('click', () => toeSetRightPane(tab.dataset.paneTarget || 'basic'));
  });

  toeSetTheme(toeGetSavedTheme());

  function toeSetTimelineHeight(height) {
    if (!toeOverlay) return;
    const next = Math.max(52, Math.min(220, height));
    toeOverlay.style.setProperty('--toe-timeline-height', `${next}px`);
    const collapsed = next <= 70;
    toeOverlay.classList.toggle('timeline-collapsed', collapsed);
    const handle = document.getElementById('toeTimelineDragHandle');
    if (handle) handle.dataset.tooltip = collapsed ? 'Show timeline' : 'Drag timeline';
    const hideBtn = document.getElementById('toeTimelineHideBtn');
    if (hideBtn) {
      hideBtn.dataset.tooltip = collapsed ? 'Show timeline' : 'Hide timeline';
      hideBtn.setAttribute('aria-label', collapsed ? 'Show timeline' : 'Hide timeline');
    }
  }

  function toeSetTimelineCollapsed(collapsed) {
    if (!toeOverlay) return;
    toeSetTimelineHeight(collapsed ? 52 : 176);
  }

  document.getElementById('toeTimelineHideBtn')?.addEventListener('click', () => {
    toeSetTimelineCollapsed(!toeOverlay.classList.contains('timeline-collapsed'));
  });

  const toeTimelineDragHandle = document.getElementById('toeTimelineDragHandle');
  if (toeTimelineDragHandle) {
    toeTimelineDragHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const timeline = document.querySelector('.toe-timeline');
      const startHeight = timeline?.getBoundingClientRect().height || 176;
      const onMove = (mv) => toeSetTimelineHeight(startHeight - (mv.clientY - startY));
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  document.querySelectorAll('[data-style-popover]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = btn.dataset.stylePopover || 'fill';
      const popover = document.getElementById('toeColorPopover');
      if (popover?.classList.contains('active') && toeStyleTarget === target) {
        popover.classList.remove('active');
        return;
      }
      toeOpenStylePicker(target);
    });
  });

  document.addEventListener('click', (e) => {
    const popover = document.getElementById('toeColorPopover');
    if (!popover || !toeOverlay || toeOverlay.style.display === 'none') return;
    if (e.target.closest('#toeColorPopover') || e.target.closest('[data-style-popover]')) return;
    popover.classList.remove('active');
    if (e.target.closest('.toe-format-popover') || e.target.closest('#toeCaseBtn') || e.target.closest('#toeSpacingBtn')) return;
    document.querySelectorAll('.toe-format-popover').forEach(panel => panel.classList.remove('active'));
  });

  document.getElementById('toeAddTextBtn')?.addEventListener('click', toeAddTextElement);
  document.getElementById('toeCancelBtn')?.addEventListener('click', toeClose);
  document.getElementById('toeCancelBtnSecondary')?.addEventListener('click', toeClose);

  document.getElementById('toeDoneBtn')?.addEventListener('click', async () => {
    if (toeTextElements.length === 0) { toeClose(); return; }
    const isVid = toeSourceMedia?.tagName === 'VIDEO';
    toeProcessing.style.display = 'flex';
    toeProcLabel.textContent = isVid ? 'Processing video... please wait' : 'Processing image...';
    try {
      let blob;
      if (isVid) {
        blob = await toeBurnVideo(toeSourceMedia);
      } else {
        blob = await toeBurnImage(toeSourceMedia);
      }
      // Create a new File object from the blob
      const ext = isVid ? 'webm' : 'jpg';
      const newFile = new File([blob], `overlay_${Date.now()}.${ext}`, { type: blob.type });
      newFile._isVideo = isVid;
      // Replace uploadedFile and trigger re-upload
      uploadedFile = newFile;
      uploadedFile._uploading = true;
      // Show in upload zone
      if (isVid) {
        const videoEl = els.uploadZone.querySelector('video') || document.createElement('video');
        videoEl.src = URL.createObjectURL(blob);
        videoEl.controls = true; videoEl.muted = true; videoEl.preload = 'metadata'; videoEl.playsInline = true;
        videoEl.style.cssText = 'max-width:100%;border-radius:12px;';
        els.uploadZone.querySelectorAll('video').forEach(v => v.remove());
        els.uploadZone.appendChild(videoEl);
        els.uploadPreview.style.display = 'none';
      } else {
        els.uploadPreview.src = URL.createObjectURL(blob);
        els.uploadPreview.classList.add('visible');
        els.uploadPreview.style.display = '';
      }
      // Upload to Supabase
      uploadedFile._uploadPromise = uploadMediaToSupabase(newFile).then(url => {
        uploadedFile._uploading = false;
        const indicator = document.getElementById('uploadProgressIndicator');
        if (indicator) indicator.remove();
        if (url) {
          uploadedFile._supabaseUrl = url;
          showToast('Text overlay applied!');
          validateForm();
        } else {
          showToast('Upload failed — try again.');
          uploadedFile = null;
          setAddTextButtonState(false);
          validateForm();
        }
        return url;
      });
      toeClose();
      validateForm();
    } catch (err) {
      console.error('Text burn error:', err);
      showToast('Error applying text — try again.');
      toeProcessing.style.display = 'none';
    }
  });

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
    els.addTextBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    els.addTextBtn.title = disabled
      ? 'Re-upload this media to add text overlays safely'
      : 'Add text overlay to your media';
    els.addTextBtn.innerHTML = disabled
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg> Re-upload to add text'
      : addTextButtonDefaultHtml;
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
      setAddTextButtonState(true, true);
      
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
      setAddTextButtonState(true, true);
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
    setAddTextButtonState(false);
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
    const isUploading = uploadedFile?._uploading === true;
    const isValid = hasMedia && hasCaption && hasDate && hasTime && hasType && !isUploading;

    els.schedulePostBtn.classList.toggle('btn-disabled', !isValid);
    els.schedulePostBtn.classList.toggle('btn-glow', isValid);
    els.schedulePostBtn.disabled = !isValid;

    if (isUploading) {
      els.schedulePostBtn.innerHTML = '<span style="display:inline-block;margin-right:6px;">⏳</span> Preparing media...';
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
      setAddTextButtonState(true);
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

      uploadedFile._uploadPromise = uploadMediaToSupabase(file).then(url => {
        uploadedFile._uploading = false;
        const indicator = document.getElementById('uploadProgressIndicator');
        if (indicator) indicator.remove();

        if (url) {
          uploadedFile._supabaseUrl = url;
          // Re-run validation to re-enable Schedule button now that upload is ready
          validateForm();
        } else {
          showToast('Media upload failed — please try again.');
          uploadedFile = null;
          els.uploadZone.querySelectorAll('video').forEach(v => v.remove());
          els.uploadPreview.src = '';
          els.uploadPreview.classList.remove('visible');
          els.uploadPlaceholder.style.display = '';
          setAddTextButtonState(false);
          validateForm();
        }
        return url;
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
        if (isOriginalVertical) {
          tempCanvas.width = 1080;
          tempCanvas.height = Math.floor((videoEl.videoHeight / videoEl.videoWidth) * 1080);
        } else {
          tempCanvas.height = 1080;
          tempCanvas.width = Math.floor((videoEl.videoWidth / videoEl.videoHeight) * 1080);
        }
        
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(videoEl, 0, 0, tempCanvas.width, tempCanvas.height);
        
        const base64 = tempCanvas.toDataURL('image/jpeg', 0.8);
        userSelectedThumbnail = base64; // show preview immediately

        if (els.capturedThumbPreview) {
          els.capturedThumbPreview.src = base64;
          els.capturedThumbPreview.style.display = 'block';
        }
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
                  showToast('Thumbnail saved!');
                }
              }
            }
          } catch (thumbErr) {
            console.warn('Thumbnail upload failed, using base64 fallback:', thumbErr);
          }
        }
      } catch (err) {
        console.warn('Could not capture video thumbnail:', err);
        showToast('Error capturing thumbnail');
      }
    });
  }

  // Remove Media Button logic
  // Add Text button — open the text overlay editor
  if (els.addTextBtn) {
    els.addTextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!uploadedFile) return;
      if (uploadedFile._existing || els.addTextBtn.classList.contains('is-disabled')) {
        showToast('Re-upload this media to add text overlays.');
        return;
      }
      toeOpen(uploadedFile);
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
        media_type: isLive ? 'NONE' : (selectedType === 'story' ? (isVideo ? 'STORY_VIDEO' : 'STORY') : (isVideo ? 'VIDEO' : 'IMAGE')),
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
        media_type: isLive ? 'NONE' : (selectedType === 'story' ? (isVideo ? 'STORY_VIDEO' : 'STORY') : (isVideo ? 'VIDEO' : 'IMAGE')),
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
    return state.posts.filter(p => p.date === dateStr && (p.status || 'pending').toLowerCase() !== 'published');
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
    state.nextId = Math.max(...sbPosts.map(p => (typeof p.id === 'number' ? p.id : 0)), 0) + 1;
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
      if (sbPosts && sbPosts.length > 0) {
        state.posts = sbPosts;
        state.nextId = Math.max(...sbPosts.map(p => (typeof p.id === 'number' ? p.id : 0)), 0) + 1;
        savePosts();
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
    renderFailureBanner();

    // Poll Supabase every 60 seconds to sync post statuses (picks up published/failed from cron)
    setInterval(syncPostsFromSupabase, 60000);
  }

  init();

})();
