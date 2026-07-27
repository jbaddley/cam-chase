const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

/**
 * Metro config for this app inside the pnpm workspace.
 *
 * Two things here are not optional:
 *
 * 1. **Workspace visibility.** `@photochase/shared`, `/client` and `/i18n` are
 *    symlinked from the repo root and published as TypeScript source, so Metro
 *    has to watch the whole monorepo and look for modules in the root
 *    `node_modules` as well as this app's.
 *
 * 2. **`.js` specifiers that mean `.ts`.** The whole codebase writes
 *    `./api.js` for a file called `api.ts` — required by TypeScript's
 *    `verbatimModuleSyntax`/NodeNext-style ESM, and understood natively by
 *    `tsc` and Vitest. Metro takes the extension literally and would report
 *    every one of them as missing, so the resolver retries without it.
 */

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// pnpm's store is a tree of symlinks; following them is how a workspace package
// reaches its own dependencies.
config.resolver.unstable_enableSymlinks = true;

const defaultResolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;
  try {
    return resolve(context, moduleName, platform);
  } catch (error) {
    // Only relative `.js`/`.jsx` specifiers get a second chance, and only after
    // the literal path has genuinely failed — so a real `.js` file on disk
    // still wins, and an unrelated resolution error is rethrown untouched.
    const rewritten = /^\.{1,2}\//.test(moduleName) ? moduleName.replace(/\.(jsx?)$/, '') : null;
    if (rewritten === null || rewritten === moduleName) throw error;
    return resolve(context, rewritten, platform);
  }
};

module.exports = config;
