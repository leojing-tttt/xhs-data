import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureSessionSecret, loadUsers } from './auth.js';
import { appRoot, createApp } from './http.js';
import { SCRCPY_VERSION } from './scrcpy.js';

async function main() {
  const root = appRoot();
  const secret = await ensureSessionSecret(path.join(root, 'config', 'session-secret'));
  const users = loadUsers(path.join(root, 'config', 'users.json'));
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '0.0.0.0';
  const server = createApp({ root, users, sessionSecret: secret });
  server.listen(port, host, () => {
    console.log(`手机控制台 http://127.0.0.1:${port}`);
    if (host === '0.0.0.0' || host === '::') {
      console.log(`同一网络里的电脑打开 http://<这台机器的IP>:${port}`);
    }
    console.log(`scrcpy ${SCRCPY_VERSION}`);
  });

  const shutdown = () => {
    server.sessionManager.stopAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
