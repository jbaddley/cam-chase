import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(dir, '..', '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workspace packages ship TypeScript source, not a build, so Next has to
  // compile them itself.
  transpilePackages: ['@photochase/shared', '@photochase/client', '@photochase/i18n'],
  // Pin the workspace root: without it Next 16 can pick a stray lockfile in $HOME
  // and trace the wrong tree.
  outputFileTracingRoot: monorepoRoot,
  webpack(config) {
    // Those packages use ESM-style `./foo.js` specifiers that actually resolve
    // to `./foo.ts` on disk. Turbopack (the Next 16 default) has no equivalent
    // of this alias, so the build runs on webpack (`next build --webpack`) and
    // keeps this mapping — without it every workspace import is "module not found".
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
