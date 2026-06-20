import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..');
const run = (cmd: string) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
};

describe('Build pipeline and type safety regression', () => {
  it('passes TypeScript type check (tsc --noEmit)', () => {
    expect(() => run('tsc --noEmit')).not.toThrow();
  }, 30000);

  it('produces a successful production build', () => {
    expect(() => run('tsc -b && vite build')).not.toThrow();
  }, 60000);

  it('emits valid build artifacts in dist/', () => {
    const distDir = resolve(ROOT, 'dist');
    expect(existsSync(resolve(distDir, 'index.html'))).toBe(true);

    const assets = resolve(distDir, 'assets');
    const files = readdirSync(assets);
    const js = files.filter((f) => f.endsWith('.js'));
    const css = files.filter((f) => f.endsWith('.css'));
    expect(js.length).toBeGreaterThan(0);
    expect(css.length).toBeGreaterThan(0);

    const jsBundle = resolve(assets, js[0]);
    const content = readFileSync(jsBundle, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  }, 10000);
});
