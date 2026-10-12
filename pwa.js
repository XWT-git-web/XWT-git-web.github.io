(() => {
  'use strict';
  if ('serviceWorker' in navigator) window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });

  const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (installed()) return;
  let promptEvent;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'install-app-button';
  button.textContent = '安装知间';
  button.setAttribute('aria-label', '将知间安装到设备');
  document.body.append(button);

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    promptEvent = event;
  });
  window.addEventListener('appinstalled', () => button.remove());

  button.addEventListener('click', async () => {
    if (promptEvent) {
      const current = promptEvent;
      promptEvent = null;
      await current.prompt();
      return;
    }
    const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const message = isAppleMobile
      ? '请用 Safari 打开本页，点击“分享”，再选择“添加到主屏幕”。'
      : '请在浏览器菜单中选择“安装应用”或“添加到主屏幕”。';
    const tip = document.createElement('div');
    tip.className = 'install-app-tip';
    tip.setAttribute('role', 'status');
    tip.textContent = message;
    tip.addEventListener('click', () => tip.remove());
    document.querySelector('.install-app-tip')?.remove();
    document.body.append(tip);
    setTimeout(() => tip.remove(), 6500);
  });
})();
