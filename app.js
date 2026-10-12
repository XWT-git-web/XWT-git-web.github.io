(() => {
  'use strict';
  const FOCUS = 50 * 60;
  const BREAK = 10 * 60;
  const GOAL = 8;
  const account = document.getElementById('appRoot');
  if (!account || !account.dataset.userId) return;
  const KEY = `zhijian-study-v2:${account.dataset.userId}`;
  const oldKey = 'zhijian-study-v1';
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const fromDateKey = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayKey = () => dateKey(new Date());
  const defaults = () => ({
    remoteRecords: {},
    pendingEvents: [],
    settingsDirty: false,
    legacyImported: false,
    timer: { phase: 'focus', status: 'idle', remaining: FOCUS, endAt: null, day: todayKey() },
    settings: { startTime: '09:00', restDay: 0, sound: true },
    lastStartReminderDate: ''
  });
  let state;
  try {
    let savedText = localStorage.getItem(KEY);
    if (!savedText && !localStorage.getItem('zhijian-legacy-claimed')) {
      savedText = localStorage.getItem(oldKey);
      if (savedText) localStorage.setItem('zhijian-legacy-claimed', account.dataset.userId);
    }
    const saved = JSON.parse(savedText || 'null');
    const base = defaults();
    state = saved && typeof saved === 'object' ? {
      ...base, ...saved,
      remoteRecords: saved.remoteRecords && typeof saved.remoteRecords === 'object' ? saved.remoteRecords : {},
      pendingEvents: Array.isArray(saved.pendingEvents) ? saved.pendingEvents : [],
      timer: { ...base.timer, ...(saved.timer || {}) },
      settings: { ...base.settings, ...(saved.settings || {}) }
    } : base;
  } catch { state = defaults(); }
  if (state.records && typeof state.records === 'object') {
    for (const [day, count] of Object.entries(state.records)) {
      for (let i = 0; i < Math.min(GOAL, Number(count) || 0); i++) state.pendingEvents.push({ id: crypto.randomUUID(), day });
    }
    delete state.records;
  }
  if (!['focus', 'break', 'done'].includes(state.timer.phase)) state.timer = defaults().timer;
  if (!['idle', 'running', 'paused'].includes(state.timer.status)) state.timer.status = 'idle';
  if (state.timer.day !== todayKey() && state.timer.status !== 'running') state.timer = defaults().timer;
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
  const completed = key => Math.min(GOAL, Math.max(0, Number(state.remoteRecords[key]) || 0) + state.pendingEvents.filter(event => event.day === key).length);
  const todayCompleted = () => completed(todayKey());
  function syncCloud() {
    $('syncStatus').textContent = '仅本机保存';
    $('syncStatus').classList.add('offline');
  }
  let toastTimeout;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.remove('show'), 3800);
  }
  let audioContext;
  function chime() {
    if (!state.settings.sound) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      [0, .17].forEach((delay, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = index ? 783.99 : 659.25;
        gain.gain.setValueAtTime(.0001, audioContext.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(.12, audioContext.currentTime + delay + .025);
        gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + delay + .4);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(audioContext.currentTime + delay);
        oscillator.stop(audioContext.currentTime + delay + .42);
      });
    } catch {}
  }
  function notify(title, body, withSound = true) {
    toast(`${title} · ${body}`);
    if (withSound) chime();
    if ('vibrate' in navigator) navigator.vibrate([120, 80, 120]);
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body, icon: '/favicon.svg', tag: 'zhijian-timer' }); } catch {}
    }
  }
  function currentRemaining() {
    if (state.timer.status === 'running' && Number.isFinite(Number(state.timer.endAt))) {
      return Math.max(0, Math.ceil((state.timer.endAt - Date.now()) / 1000));
    }
    return Math.max(0, Number(state.timer.remaining) || 0);
  }
  function advanceTimer() {
    const t = state.timer;
    if (t.status !== 'running' || Date.now() < t.endAt) return;
    if (t.phase === 'focus') {
      const key = t.day || todayKey();
      state.pendingEvents.push({ id: crypto.randomUUID(), day: key });
      if (completed(key) >= GOAL) {
        t.phase = 'done'; t.status = 'idle'; t.remaining = 0; t.endAt = null;
        notify('今天的目标完成啦', '8 轮学习全部完成，好好休息吧。');
      } else {
        const breakEnd = t.endAt + BREAK * 1000;
        t.phase = 'break'; t.status = 'running'; t.remaining = BREAK; t.endAt = breakEnd;
        notify('学习完成，休息一下', `已完成第 ${completed(key)} 轮。10 分钟后提醒你继续。`);
        if (Date.now() >= breakEnd) advanceTimer();
      }
    } else if (t.phase === 'break') {
      t.phase = 'focus'; t.status = 'idle'; t.remaining = FOCUS; t.endAt = null;
      t.day = todayKey();
      notify('休息结束', '准备好就开始下一轮 50 分钟学习。');
    }
    persist();
    syncCloud();
  }
  function normalizeDay() {
    const t = state.timer;
    if (t.day !== todayKey() && t.status !== 'running') {
      state.timer = defaults().timer;
      persist();
    }
    if (completed(todayKey()) >= GOAL && state.timer.day === todayKey() && state.timer.status !== 'running') {
      state.timer = { phase: 'done', status: 'idle', remaining: 0, endAt: null, day: todayKey() };
    }
  }
  function formatTime(seconds) { return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`; }
  function weekStart(date) { const result = new Date(date.getFullYear(), date.getMonth(), date.getDate()); result.setDate(result.getDate() - ((result.getDay() + 6) % 7)); return result; }
  function renderWeek() {
    const monday = weekStart(new Date());
    const labels = ['周一','周二','周三','周四','周五','周六','周日'];
    let achieved = 0;
    $('weekDays').innerHTML = labels.map((label, index) => {
      const date = new Date(monday); date.setDate(monday.getDate() + index);
      const key = dateKey(date); const count = completed(key); const complete = count >= GOAL;
      const isRest = date.getDay() === Number(state.settings.restDay);
      if (complete) achieved++;
      const cls = ['week-day', key === todayKey() ? 'today' : '', complete ? 'complete' : '', isRest ? 'rest' : ''].filter(Boolean).join(' ');
      const icon = complete ? '✓' : isRest ? '☕' : count ? '◕' : '○';
      const detail = complete ? '已完成' : isRest && count === 0 ? '休息日' : `${count} / 8 轮`;
      return `<div class="${cls}" aria-label="${label} ${date.getMonth()+1}月${date.getDate()}日 ${detail}"><span class="week-day-name">${label}</span><span class="week-day-icon" aria-hidden="true">${icon}</span><span class="week-day-detail">${detail}</span></div>`;
    }).join('');
    $('weekCount').textContent = achieved;
    const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
    $('weekRange').textContent = `${monday.getMonth()+1}.${pad(monday.getDate())} — ${sunday.getMonth()+1}.${pad(sunday.getDate())}`;
  }
  function render() {
    advanceTimer(); normalizeDay();
    const t = state.timer;
    const remaining = currentRemaining();
    const count = todayCompleted();
    const isBreak = t.phase === 'break';
    const isDone = t.phase === 'done';
    $('todayDate').textContent = new Intl.DateTimeFormat('zh-CN', { month:'long', day:'numeric', weekday:'long' }).format(new Date());
    const hour = new Date().getHours();
    $('greetingTitle').textContent = isDone ? '今天的学习，圆满完成。' : hour < 11 ? '早上好，开启专注的一天。' : hour < 18 ? '今天，也一起好好学习。' : '晚上好，再专注一会儿。';
    $('phaseBadge').textContent = isDone ? '今日达标' : isBreak ? '休息时间' : t.status === 'running' ? '正在专注' : t.status === 'paused' ? '已暂停' : '准备开始';
    $('timerTime').textContent = formatTime(remaining);
    $('timerCaption').textContent = isDone ? '今天辛苦了' : isBreak ? '放松一下，稍后继续' : t.status === 'running' ? '保持专注，你正在进步' : t.status === 'paused' ? '随时继续这一轮' : '准备好就开始吧';
    $('timerRing').classList.toggle('break', isBreak);
    $('timerRing').style.setProperty('--progress', `${Math.max(0, Math.min(100, (1 - remaining / (isBreak ? BREAK : FOCUS)) * 100))}%`);
    $('timerRing').setAttribute('aria-label', `${isBreak ? '休息' : '学习'}剩余 ${formatTime(remaining)}`);
    $('sessionFraction').textContent = `${count} / ${GOAL} 轮`;
    $('sessionDots').innerHTML = Array.from({ length: GOAL }, (_, i) => `<span class="session-dot ${i < count ? 'done' : i === count && !isDone ? 'current' : ''}"></span>`).join('');
    $('sessionDots').setAttribute('aria-label', `今日已完成 ${count} / ${GOAL} 轮`);
    $('dailyCount').textContent = count;
    $('dailyMinutes').textContent = `${count * 50} 分钟`;
    $('dailyProgress').style.width = `${count / GOAL * 100}%`;
    $('dailyMessage').textContent = count >= GOAL ? '今天的 8 轮已完成，做得真好。' : count === 0 ? '完成第一轮，让今天有个好开始。' : `再完成 ${GOAL - count} 轮，就能点亮今天。`;
    $('nextIcon').textContent = isBreak ? '✳' : '☕';
    $('nextTitle').textContent = isDone ? '明天继续前进' : isBreak ? '下一轮学习' : '专注后的休息';
    $('nextDescription').textContent = isDone ? '保持节奏，明天见。' : isBreak ? '休息结束后，开始新的 50 分钟。' : '完成一轮后，给自己 10 分钟放松。';
    $('actionLabel').textContent = isDone ? '今日已完成' : t.status === 'running' ? '暂停计时' : t.status === 'paused' ? '继续计时' : isBreak ? '开始休息' : '开始学习';
    $('actionSymbol').textContent = t.status === 'running' ? 'Ⅱ' : '▶';
    $('primaryAction').disabled = isDone;
    $('secondaryAction').hidden = isDone || (t.status === 'idle' && !isBreak);
    $('secondaryAction').textContent = isBreak ? '跳过休息' : '重置本轮';
    $('timerHint').textContent = isDone ? '每周目标：完成 6 天打卡' : isBreak ? '休息 10 分钟，接着开启下一轮' : '每轮学习 50 分钟，然后休息 10 分钟';
    document.title = t.status === 'running' ? `${formatTime(remaining)} · ${isBreak ? '休息中' : '专注中'} | 知间` : '知间 · 学习打卡';
    renderWeek();
  }
  $('primaryAction').addEventListener('click', () => {
    advanceTimer();
    const t = state.timer;
    if (t.phase === 'done') return;
    if (t.status === 'running') {
      t.remaining = currentRemaining(); t.endAt = null; t.status = 'paused';
      toast('计时已暂停');
    } else {
      if (t.phase === 'focus' && completed(todayKey()) >= GOAL) return;
      if (t.day !== todayKey() && t.phase === 'focus') t.day = todayKey();
      t.endAt = Date.now() + t.remaining * 1000; t.status = 'running';
      toast(t.phase === 'break' ? '休息开始，放松一下' : '专注开始，加油');
      if (state.settings.sound) chime();
    }
    persist(); render();
  });
  $('secondaryAction').addEventListener('click', () => {
    const t = state.timer;
    if (t.phase === 'break') {
      state.timer = { phase:'focus', status:'idle', remaining:FOCUS, endAt:null, day:todayKey() };
      toast('休息已跳过，可以开始下一轮');
    } else if (confirm('重置本轮计时？这一轮的进度不会保存。')) {
      state.timer = { phase:'focus', status:'idle', remaining:FOCUS, endAt:null, day:todayKey() };
      toast('本轮已重置');
    } else return;
    persist(); render();
  });
  const dialog = $('settingsDialog');
  function updateNotificationStatus() {
    const supported = 'Notification' in window;
    const permission = supported ? Notification.permission : 'unsupported';
    $('notificationStatus').textContent = permission === 'granted' ? '通知已开启，阶段切换时会提醒你。' : permission === 'denied' ? '浏览器已阻止通知，请在浏览器设置中开启。' : permission === 'unsupported' ? '当前浏览器不支持桌面通知。' : '允许通知后，学习与休息切换时会提醒你。';
    $('notificationButton').textContent = permission === 'granted' ? '已开启' : permission === 'denied' ? '已阻止' : '开启通知';
    $('notificationButton').disabled = permission !== 'default';
  }
  function openSettings() {
    $('startTime').value = state.settings.startTime;
    $('restDay').value = String(state.settings.restDay);
    $('soundEnabled').checked = !!state.settings.sound;
    $('accountLabel').textContent = '离线模式 · 数据保存在本设备';
    updateNotificationStatus();
    dialog.showModal();
  }
  $('settingsNav').addEventListener('click', openSettings);
  $('settingsTop').addEventListener('click', openSettings);
  $('notificationButton').addEventListener('click', async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch {}
      updateNotificationStatus();
    }
  });
  $('saveSettings').addEventListener('click', event => {
    event.preventDefault();
    state.settings.startTime = /^\d{2}:\d{2}$/.test($('startTime').value) ? $('startTime').value : '09:00';
    state.settings.restDay = Number($('restDay').value);
    state.settings.sound = $('soundEnabled').checked;
    state.settingsDirty = false;
    persist(); render(); dialog.close(); toast('提醒设置已保存'); syncCloud();
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  function scheduledReminder() {
    const now = new Date();
    const key = todayKey();
    if (now.getDay() === Number(state.settings.restDay) || state.lastStartReminderDate === key || completed(key) >= GOAL || state.timer.status !== 'idle' || state.timer.phase !== 'focus') return;
    const [hour, minute] = state.settings.startTime.split(':').map(Number);
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
    const delta = now - due;
    if (delta >= 0 && delta < 30 * 60 * 1000) {
      state.lastStartReminderDate = key;
      persist();
      notify('该开始学习啦', '用 50 分钟，完成今天的第一轮专注。', false);
    }
  }
  function tick() { render(); scheduledReminder(); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('focus', tick);
  window.addEventListener('storage', event => { if (event.key === KEY) location.reload(); });
  tick();
  setInterval(tick, 1000);
  syncCloud();
})();
