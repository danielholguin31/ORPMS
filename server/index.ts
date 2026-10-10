import 'dotenv/config';
import { configuration } from './config';
import { createApp } from './app';
import { DemoStore } from './store/demo';
import { PostgresStore } from './store/postgres';
import { demoSeed } from './seed';

const config = configuration();
const store =
  config.mode === 'demo'
    ? await DemoStore.open(config.dataPath, demoSeed())
    : new PostgresStore(config.databaseUrl!, config.workspaceId!, config.databaseCaFile);
await store.read();
const app = createApp(store, config);
const server = app.listen(config.port, config.mode === 'demo' ? '127.0.0.1' : '0.0.0.0', () =>
  process.stdout.write(`Openrange API: http://127.0.0.1:${config.port} (${config.mode})\n`),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    server.close(() => {
      store.close().then(() => process.exit(0));
    });
  });
