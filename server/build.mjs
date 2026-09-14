/**
 * Bundle the server to a single file. Two reasons, both about cold start: the runtime image drops the
 * whole node_modules tree (81 MB → a 7.5 MB bundle), so there is far less to pull, and Node parses one
 * file instead of thousands — which is what the ~2.4 s app-init phase was spent on.
 *
 * `node build.mjs --with-smoke` also bundles the in-process smokes through the SAME pipeline and they
 * can then be run from `dist/bundled-smoke/`. That is the only honest way to prove the bundle works:
 * ydb-sdk drags in grpc-js, protobufjs and rxjs, the parts most likely to resist bundling, and a bundle
 * that merely *builds* can still fail at first require.
 */
import { build } from 'esbuild';

/**
 * ydb-sdk's own MetadataAuthService lazily imports `@yandex-cloud/nodejs-sdk`, a very heavy package we
 * deliberately do not install — ydb.ts has a hand-rolled `MetadataAuth` instead. The import sits inside
 * `createMetadata()`, which only that class calls, so it is dead code here. Stub it rather than marking
 * it external: an external would leave an unresolvable require in the bundle for someone to trip over.
 */
const stubYcSdk = {
  name: 'stub-yc-sdk',
  setup(b) {
    b.onResolve({ filter: /^@yandex-cloud\/nodejs-sdk(\/|$)/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents:
        'export const MetadataTokenService=class{constructor(){throw new Error("@yandex-cloud/nodejs-sdk is not bundled; ydb.ts uses its own MetadataAuth")}};',
      loader: 'js',
    }));
  },
};

const common = {
  plugins: [stubYcSdk],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // grpc-js and protobufjs call CommonJS `require` at runtime; an ESM bundle has none in scope.
  banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
};

const result = await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/bundle.mjs', metafile: true });
console.log(`bundle: ${(result.metafile.outputs['dist/bundle.mjs'].bytes / 1024 / 1024).toFixed(1)} MB`);

if (process.argv.includes('--with-smoke')) {
  await build({
    ...common,
    entryPoints: ['src/smoke.ts', 'src/entitlementApi.smoke.ts', 'src/aiApi.smoke.ts'],
    outdir: 'dist/bundled-smoke',
    outExtension: { '.js': '.mjs' },
  });
  console.log('bundled smokes → dist/bundled-smoke/');
}
