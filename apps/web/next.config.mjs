/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workspace packages ship TypeScript source, not a build, so Next has to
  // compile them itself.
  transpilePackages: ['@photochase/shared', '@photochase/client'],
  webpack(config) {
    // Those packages use ESM-style `./foo.js` specifiers that actually resolve
    // to `./foo.ts` on disk. Without this alias webpack reports every one as a
    // missing module.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
