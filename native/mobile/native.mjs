import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

if (Capacitor.isNativePlatform()) {
  const timerIds = [501, 502];
  const dailyIds = [601, 602, 603, 604, 605, 606, 607];
  const descriptors = ids => ids.map(id => ({ id }));
  const getState = () => {
    const userId = document.getElementById('appRoot')?.dataset.userId || 'offline';
    try { return JSON.parse(localStorage.getItem(`zhijian-study-v2:${userId}`) || 'null'); } catch { return null; }
  };
  const permissionGranted = async () => (await LocalNotifications.checkPermissions()).display === 'granted';
  let updateQueue = Promise.resolve();
  const serialized = task => { updateQueue = updateQueue.then(task).catch(() => {}); return updateQueue; };

  async function scheduleTimer() {
    await LocalNotifications.cancel({ notifications: descriptors(timerIds) });
    if (document.visibilityState === 'visible' || !(await permissionGranted())) return;
    const state = getState();
    const timer = state?.timer;
    const endAt = Number(timer?.endAt);
    if (timer?.status !== 'running' || !Number.isFinite(endAt) || endAt <= Date.now()) return;
    const notifications = [];
    const schedule = at => ({ at: new Date(at), allowWhileIdle: true });
    if (timer.phase === 'focus') {
      notifications.push({ id: 501, title: '知间 · 学习完成', body: '50 分钟结束，休息 10 分钟。', schedule: schedule(endAt) });
      const day = timer.day;
      const count = Number(state.remoteRecords?.[day] || 0) + (state.pendingEvents || []).filter(event => event.day === day).length;
      if (count < 7) notifications.push({ id: 502, title: '知间 · 休息结束', body: '准备开始下一轮 50 分钟学习。', schedule: schedule(endAt + 10 * 60 * 1000) });
    } else if (timer.phase === 'break') {
      notifications.push({ id: 502, title: '知间 · 休息结束', body: '准备开始下一轮 50 分钟学习。', schedule: schedule(endAt) });
    }
    if (notifications.length) await LocalNotifications.schedule({ notifications });
  }

  async function scheduleDaily() {
    await LocalNotifications.cancel({ notifications: descriptors(dailyIds) });
    if (!(await permissionGranted())) return;
    const settings = getState()?.settings;
    const [hour, minute] = String(settings?.startTime || '09:00').split(':').map(Number);
    const restDay = Number(settings?.restDay ?? 0);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return;
    const notifications = Array.from({ length: 7 }, (_, day) => day)
      .filter(day => day !== restDay)
      .map(day => ({
        id: 601 + day,
        title: '知间 · 该开始学习啦',
        body: '用 50 分钟，完成今天的第一轮专注。',
        schedule: { on: { weekday: day + 1, hour, minute, second: 0 }, allowWhileIdle: true }
      }));
    if (notifications.length) await LocalNotifications.schedule({ notifications });
  }

  async function requestPermission() {
    const result = await LocalNotifications.requestPermissions();
    if (result.display === 'granted') await scheduleDaily();
    await refreshPermissionStatus();
  }

  async function refreshPermissionStatus() {
    const granted = await permissionGranted();
    const button = document.getElementById('notificationButton');
    button.disabled = false;
    button.textContent = granted ? '已开启' : '开启通知';
    document.getElementById('notificationStatus').textContent = granted
      ? '系统通知已开启，退到后台也会提醒你。'
      : '允许系统通知后，退到后台也能收到计时提醒。';
  }

  document.getElementById('primaryAction')?.addEventListener('click', () => { void requestPermission().catch(() => {}); });
  document.getElementById('notificationButton')?.addEventListener('click', event => {
    event.stopImmediatePropagation();
    void requestPermission().catch(() => {});
  }, true);
  for (const id of ['settingsNav', 'settingsTop']) {
    document.getElementById(id)?.addEventListener('click', () => { setTimeout(() => void refreshPermissionStatus().catch(() => {}), 0); });
  }
  document.getElementById('saveSettings')?.addEventListener('click', () => { setTimeout(() => void serialized(scheduleDaily), 0); });
  document.addEventListener('visibilitychange', () => { void serialized(scheduleTimer); });
  document.addEventListener('zhijian-account-ready', () => { void serialized(scheduleDaily); });
  window.addEventListener('focus', () => { void serialized(scheduleTimer); });
  void serialized(scheduleDaily);
}
