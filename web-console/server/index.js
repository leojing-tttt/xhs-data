import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchSearchBrowser } from './browser.js';
import { createHttpServer } from './http.js';
import { createRunner } from './runner.js';
import { createTaskService } from './tasks.js';

const root = fileURLToPath(new URL('..', import.meta.url));

export function startConsole(options = {}) {
  const dataDir = options.dataDir || process.env.XHS_DATA_DIR || join(root, 'data');
  const runner = options.runner || createRunner({
    openBrowser: (input) => launchSearchBrowser({
      keyword: input.keyword,
      userDataDir: join(dataDir, 'chrome-profile'),
    }),
    firstTimeoutMs: numberFrom(process.env.XHS_FIRST_RESPONSE_MS, 180000),
    nextTimeoutMs: numberFrom(process.env.XHS_NEXT_RESPONSE_MS, 8000),
  });
  const tasks = createTaskService({ dir: dataDir, runner });
  const server = createHttpServer({
    tasks,
    publicDir: join(root, 'public'),
  });
  const port = options.port ?? numberFrom(process.env.PORT, 8788);
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        tasks,
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        async close() {
          tasks.stop();
          await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
        },
      });
    });
  });
}

function numberFrom(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startConsole().then((app) => {
    console.log(`网页控制台 ${app.url}`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
