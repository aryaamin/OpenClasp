import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const sourceDirectory = join(dirname(require.resolve('geist/font/sans')), 'fonts/geist-sans');
const outputDirectory = resolve('.openclasp-build', 'agent-card-fonts');

mkdirSync(outputDirectory, { recursive: true });
for (const filename of ['Geist-Regular.ttf', 'Geist-Bold.ttf']) {
  copyFileSync(join(sourceDirectory, filename), join(outputDirectory, filename));
}
