import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist');

await mkdir(resolve(output, 'js'), { recursive: true });
await cp(resolve(root, 'js'), resolve(output, 'js'), { recursive: true });
