const { app, BrowserWindow, net, protocol, session } = require('electron');
const { join, resolve, sep } = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'zhijian', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

const rendererDir = resolve(__dirname, 'renderer');
const appUrl = 'zhijian://app/index.html';

function createWindow() {
  const window = new BrowserWindow({
    width: 1160,
    height: 850,
    minWidth: 360,
    minHeight: 500,
    title: '知间',
    backgroundColor: '#f7f5ef',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith('zhijian://app/')) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  window.loadURL(appUrl);
}

app.whenReady().then(() => {
  app.setName('知间');
  protocol.handle('zhijian', request => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = resolve(rendererDir, relative);
    if (file !== rendererDir && !file.startsWith(rendererDir + sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(permission === 'notifications' && contents.getURL().startsWith('zhijian://app/'));
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
