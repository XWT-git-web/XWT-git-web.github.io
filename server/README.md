# 知间 API

目前用于本地开发。北京 ECS 在完成域名备案前不要对公网开放。生产部署时只让 Uvicorn 监听 `127.0.0.1`，由 HTTPS 反向代理转发 `/api/` 和 `/healthz`。

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app:app --host 127.0.0.1 --port 8000
```

另一个终端在仓库根目录运行 `python3 -m http.server 5173 --bind 127.0.0.1`。将根目录 [`cloud-config.js`](../cloud-config.js) 的地址临时设为 `http://127.0.0.1:8000`，即可在 `http://127.0.0.1:5173` 测试完整注册、登录、同步界面；测试后将地址恢复为空。运行 `python -m pytest -q` 检查后端。

环境变量：`ZHIJIAN_DB_PATH` 指定 SQLite 数据库路径；`ZHIJIAN_ALLOWED_ORIGINS` 以逗号分隔可访问 API 的网页或 App 来源。默认只允许本地开发地址和 App 来源。账号可用邮箱或手机号加密码注册；目前不验证邮箱/手机号，因此**尚不能找回密码**。生产使用前应配置 HTTPS、备份、日志轮转和反向代理限流。

`POST /api/register`、`POST /api/login` 返回 30 天的会话令牌；之后用 `Authorization: Bearer <token>` 请求。`GET /api/state` 获取打卡、设置和计时状态；`POST /api/sync` 幂等上传打卡事件，以版本号防止覆盖较新的设置/计时状态；`POST /api/password` 修改密码并使其他设备退出；`DELETE /api/account` 删除账号及其数据；`POST /api/logout` 退出。数据存在 SQLite 中，密码使用 PBKDF2-SHA256（60 万轮）加盐哈希，令牌只存 SHA-256 摘要。

## 上线准备（备案完成后）

1. 将源码复制到 ECS 的 `/opt/zhijian`，创建独立系统用户 `zhijian` 和仅该用户可写的 `/var/lib/zhijian`。安装 Python 3.9+，在 `server` 下创建虚拟环境并安装 `requirements.txt`。
2. 用 [`deploy/api.env.example`](deploy/api.env.example) 创建 `/etc/zhijian/api.env`，设置数据库路径及允许访问 API 的网页和 App 来源。该文件只放在服务器，不提交账号或密钥。将 [`deploy/zhijian-api.service.example`](deploy/zhijian-api.service.example) 改名复制到 systemd 服务目录并启用；确认 API 只监听 `127.0.0.1:8000`。
3. 在 ECS 的 `/opt/zhijian/site` 放入网页静态文件：`index.html`、`style.css`、`app.js`、`cloud.js`、`cloud-config.js`、`pwa.js`、`sw.js`、`manifest.webmanifest`、`favicon.svg` 和图标 PNG。不要把 `server/` 或私钥放进网页目录。使用 [`deploy/nginx.conf.example`](deploy/nginx.conf.example) 配置已备案的正式域名和有效 HTTPS 证书，同一域名提供网页与 API。ECS 安全组只开放必要的 443 端口，不开放 8000。
4. 在网站目录的 `cloud-config.js` 写入 `https://你的已备案域名`；构建桌面和 Android App 时设置 `ZHIJIAN_API_URL=https://你的已备案域名`，重新生成安装包。iPhone/iPad 的添加到主屏幕版本跟随网页更新。现有 v1.1.0 安装包不会自动获得云端功能。
5. 备份数据库，例如 `ZHIJIAN_DB_PATH=/var/lib/zhijian/zhijian.sqlite3 python backup.py /var/backups/zhijian/$(date +%F).sqlite3`。备份必须另存到可靠位置，并定期验证可恢复。

生产上线前还要配置反向代理限流、HTTPS 证书续期、服务监控和数据库备份。账号目前不验证邮箱/手机号，也无法找回密码；这点已在界面中说明。
