(() => {
  'use strict';
  const apiBase = String(window.ZHIJIAN_API_URL || '').replace(/\/+$/, '');
  const appRoot = document.getElementById('appRoot');
  const authPage = document.getElementById('authPage');
  const tokenKey = 'zhijian-cloud-token';
  const userKey = 'zhijian-cloud-user';
  let token = localStorage.getItem(tokenKey) || '';
  let user = null;
  let state = null;
  let persist = null;
  let render = null;
  let inFlight = false;
  let retry = false;
  let syncTimer;

  function loadApp() {
    const script = document.createElement('script');
    script.src = '/app.js';
    document.body.append(script);
  }
  if (!apiBase) {
    loadApp();
    return;
  }

  async function request(path, method = 'GET', body) {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(typeof data.detail === 'string' ? data.detail : `请求失败（${response.status}）`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  const status = (label, offline = false) => {
    const el = document.getElementById('syncStatus');
    el.textContent = label;
    el.classList.toggle('offline', offline);
  };
  function clearSession() {
    token = '';
    user = null;
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(userKey);
  }
  function showAuth(message = '') {
    appRoot.hidden = true;
    authPage.hidden = false;
    document.getElementById('authError').textContent = message;
    document.getElementById('authError').hidden = !message;
    document.title = '登录 · 知间';
  }
  function localKey() { return `zhijian-study-v2:${user.id}`; }
  function applyServer(remote) {
    if (!state) return;
    state.remoteRecords = remote.records || {};
    state.pendingEvents = (state.pendingEvents || []).filter(event => !remote.acknowledged?.includes(event.id));
    if (remote.settings) {
      if (!state.settingsDirty) state.settings = { startTime: remote.settings.startTime, restDay: remote.settings.restDay, sound: remote.settings.sound };
      state.settingsVersion = remote.settings.version;
    }
    if (remote.timer) {
      if (!state.timerDirty && remote.timer.day) {
        state.timer = { phase: remote.timer.phase, status: remote.timer.status, remaining: remote.timer.remaining, endAt: remote.timer.endAt, day: remote.timer.day, sessionId: remote.timer.sessionId };
      }
      state.timerVersion = remote.timer.version;
    }
    persist();
    render();
  }
  function setupAdapter() {
    window.zhijianCloud = {
      user,
      attach(current, save, refresh) {
        state = current;
        persist = save;
        render = refresh;
        status('已连接云端');
        scheduleSync();
      },
      sync: scheduleSync,
      async logout() {
        try { await request('/api/logout', 'POST'); } catch {}
        clearSession();
        location.reload();
      }
    };
  }
  function scheduleSync() {
    if (!state) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void flush(), 250);
  }
  async function flush() {
    if (inFlight) { retry = true; return; }
    if (!state) return;
    inFlight = true;
    const events = [...(state.pendingEvents || [])].slice(0, 100);
    const settings = state.settingsDirty ? { ...state.settings, version: state.settingsVersion || 0 } : null;
    const timer = state.timerDirty ? { ...state.timer, version: state.timerVersion || 0 } : null;
    const settingsSnapshot = settings && JSON.stringify(state.settings);
    const timerSnapshot = timer && JSON.stringify(state.timer);
    status('正在同步…');
    try {
      const remote = events.length || settings || timer
        ? await request('/api/sync', 'POST', { events, settings, timer })
        : await request('/api/state');
      if (settings && !remote.conflicts.includes('settings') && JSON.stringify(state.settings) === settingsSnapshot) state.settingsDirty = false;
      if (timer && !remote.conflicts.includes('timer') && JSON.stringify(state.timer) === timerSnapshot) state.timerDirty = false;
      applyServer(remote);
      status('已同步');
      if (remote.conflicts.length || (state.pendingEvents || []).length > 0 || state.settingsDirty || state.timerDirty) retry = true;
    } catch (error) {
      if (error.status === 401) {
        clearSession();
        location.reload();
        return;
      }
      status('离线 · 待同步', true);
    } finally {
      inFlight = false;
      if (retry) { retry = false; scheduleSync(); }
    }
  }
  async function enter(remote, newlyRegistered = false) {
    const key = localKey();
    let saved;
    try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
    if (!saved || typeof saved !== 'object') saved = {};
    if (newlyRegistered && !localStorage.getItem('zhijian-cloud-imported-offline')) {
      try {
        const offline = JSON.parse(localStorage.getItem('zhijian-study-v2:offline') || 'null');
        if (offline && typeof offline === 'object') {
          const imported = Array.isArray(offline.pendingEvents) ? offline.pendingEvents.filter(e => e && typeof e.id === 'string' && typeof e.day === 'string') : [];
          for (const [day, count] of Object.entries(offline.remoteRecords || {})) {
            for (let i = 0; i < Math.min(8, Number(count) || 0); i++) imported.push({ id: crypto.randomUUID(), day });
          }
          saved.pendingEvents = imported;
          if (offline.settings) { saved.settings = offline.settings; saved.settingsDirty = true; }
          localStorage.setItem('zhijian-cloud-imported-offline', user.id);
        }
      } catch {}
    }
    saved.remoteRecords = remote.records || {};
    saved.pendingEvents = Array.isArray(saved.pendingEvents) ? saved.pendingEvents : [];
    if (!saved.settingsDirty) saved.settings = { startTime: remote.settings.startTime, restDay: remote.settings.restDay, sound: remote.settings.sound };
    saved.settingsVersion = remote.settings.version;
    if (!saved.timerDirty && remote.timer.day) saved.timer = remote.timer;
    saved.timerVersion = remote.timer.version;
    localStorage.setItem(key, JSON.stringify(saved));
    appRoot.dataset.userId = user.id;
    appRoot.dataset.identifier = user.identifier;
    setupAdapter();
    authPage.hidden = true;
    appRoot.hidden = false;
    document.getElementById('logoutButton').hidden = false;
    document.getElementById('accountButton').hidden = false;
    document.querySelector('.settings-note').textContent = '打卡、设置和计时状态会在联网时同步到账号。离线时可继续使用，重新联网后自动同步。提醒需要保持应用运行；设备省电设置可能影响准点。';
    document.dispatchEvent(new Event('zhijian-account-ready'));
    loadApp();
  }
  async function resume() {
    try {
      user = await request('/api/me');
      localStorage.setItem(userKey, JSON.stringify(user));
      await enter(await request('/api/state'));
    } catch (error) {
      if (error.status === 401) {
        clearSession();
        showAuth('登录已失效，请重新登录。');
        return;
      }
      try {
        const cachedUser = JSON.parse(localStorage.getItem(userKey) || 'null');
        const cachedState = cachedUser && JSON.parse(localStorage.getItem(`zhijian-study-v2:${cachedUser.id}`) || 'null');
        if (cachedUser?.id && cachedState?.settings && cachedState?.timer) {
          user = cachedUser;
          await enter({ records: cachedState.remoteRecords || {}, settings: { ...cachedState.settings, version: cachedState.settingsVersion || 0 }, timer: { ...cachedState.timer, version: cachedState.timerVersion || 0 } });
          status('离线 · 待同步', true);
          return;
        }
      } catch {}
      showAuth('暂时无法连接服务器，请检查网络后重试。');
    }
  }
  let mode = 'login';
  function setMode(value) {
    mode = value;
    document.getElementById('registerTab').classList.toggle('selected', mode === 'register');
    document.getElementById('loginTab').classList.toggle('selected', mode === 'login');
    document.getElementById('confirmGroup').hidden = mode !== 'register';
    document.getElementById('authHeading').textContent = mode === 'register' ? '创建你的账号' : '欢迎回来';
    document.getElementById('authSubmit').textContent = mode === 'register' ? '创建账号并开始 ↗' : '登录并继续 ↗';
    document.getElementById('authPassword').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    document.getElementById('authError').hidden = true;
  }
  document.getElementById('loginTab').addEventListener('click', () => setMode('login'));
  document.getElementById('registerTab').addEventListener('click', () => setMode('register'));
  document.getElementById('authForm').addEventListener('submit', async event => {
    event.preventDefault();
    const identifier = document.getElementById('authIdentifier').value.trim();
    const password = document.getElementById('authPassword').value;
    const errorEl = document.getElementById('authError');
    const button = document.getElementById('authSubmit');
    if (mode === 'register' && password !== document.getElementById('authConfirm').value) {
      errorEl.textContent = '两次输入的密码不一致。'; errorEl.hidden = false; return;
    }
    button.disabled = true;
    errorEl.hidden = true;
    try {
      const result = await request(`/api/${mode}`, 'POST', { identifier, password });
      token = result.token;
      user = result.user;
      localStorage.setItem(tokenKey, token);
      localStorage.setItem(userKey, JSON.stringify(user));
      await enter(await request('/api/state'), mode === 'register');
    } catch (error) {
      errorEl.textContent = error.message === 'Failed to fetch' ? '无法连接服务器，请检查网络。' : error.message;
      errorEl.hidden = false;
    } finally { button.disabled = false; }
  });
  document.getElementById('logoutButton').addEventListener('click', () => void window.zhijianCloud.logout());
  const accountDialog = document.getElementById('accountDialog');
  const accountError = document.getElementById('accountError');
  const accountSuccess = document.getElementById('accountSuccess');
  document.getElementById('accountButton').addEventListener('click', () => {
    document.getElementById('settingsDialog').close();
    accountError.hidden = true;
    accountSuccess.hidden = true;
    accountDialog.showModal();
  });
  document.getElementById('closeAccount').addEventListener('click', () => accountDialog.close());
  document.getElementById('passwordForm').addEventListener('submit', async event => {
    event.preventDefault();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    accountError.hidden = true;
    accountSuccess.hidden = true;
    if (newPassword !== document.getElementById('confirmNewPassword').value) {
      accountError.textContent = '两次输入的新密码不一致。'; accountError.hidden = false; return;
    }
    try {
      await request('/api/password', 'POST', { currentPassword, newPassword });
      document.getElementById('passwordForm').reset();
      accountSuccess.textContent = '密码已修改。其他设备需重新登录。';
      accountSuccess.hidden = false;
    } catch (error) { accountError.textContent = error.message; accountError.hidden = false; }
  });
  document.getElementById('deleteAccount').addEventListener('click', async () => {
    const password = document.getElementById('deletePassword').value;
    accountError.hidden = true;
    if (!password) { accountError.textContent = '请先输入密码。'; accountError.hidden = false; return; }
    if (!confirm('确定永久删除知间账号和全部云端打卡记录吗？此操作无法恢复。')) return;
    try {
      await request('/api/account', 'DELETE', { password });
      localStorage.removeItem(localKey());
      clearSession();
      location.reload();
    } catch (error) { accountError.textContent = error.message; accountError.hidden = false; }
  });
  window.addEventListener('focus', () => { if (state) void flush(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state) void flush(); });
  setInterval(() => { if (state && navigator.onLine) void flush(); }, 30000);
  showAuth();
  if (token) void resume();
})();
