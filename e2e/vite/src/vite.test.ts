import { names } from '@nx/devkit';
import {
  cleanupProject,
  createFile,
  directoryExists,
  exists,
  fileExists,
  getPackageManagerCommand,
  listFiles,
  newProject,
  readFile,
  rmDist,
  runCLI,
  runCommand,
  runCLIAsync,
  tmpProjPath,
  uniq,
  updateFile,
  updateJson,
  checkFilesExist,
} from '@nx/e2e/utils';

const myApp = uniq('my-app');

describe('Vite Plugin', () => {
  let proj: string;

  describe('Vite on React apps', () => {
    describe('set up new React app with --bundler=vite option', () => {
      beforeEach(async () => {
        proj = newProject({
          packages: ['@nx/react'],
        });
        runCLI(`generate @nx/react:app ${myApp} --bundler=vite`);
        createFile(`apps/${myApp}/public/hello.md`, `# Hello World`);
      });
      afterEach(() => cleanupProject());
      it('should build application', async () => {
        runCLI(`build ${myApp}`);
        expect(readFile(`dist/apps/${myApp}/favicon.ico`)).toBeDefined();
        expect(readFile(`dist/apps/${myApp}/hello.md`)).toBeDefined();
        expect(readFile(`dist/apps/${myApp}/index.html`)).toBeDefined();
        rmDist();
      }, 200_000);
    });
  });

  describe('Vite on Web apps', () => {
    describe('set up new @nx/web app with --bundler=vite option', () => {
      beforeEach(() => {
        proj = newProject({
          packages: ['@nx/web'],
        });
        runCLI(`generate @nx/web:app ${myApp} --bundler=vite`);
      });
      afterEach(() => cleanupProject());
      it('should build application', async () => {
        runCLI(`build ${myApp}`);
        expect(readFile(`dist/apps/${myApp}/index.html`)).toBeDefined();
        const fileArray = listFiles(`dist/apps/${myApp}/assets`);
        const mainBundle = fileArray.find((file) => file.endsWith('.js'));
        expect(
          readFile(`dist/apps/${myApp}/assets/${mainBundle}`)
        ).toBeDefined();
        expect(fileExists(`dist/apps/${myApp}/package.json`)).toBeFalsy();
        rmDist();
      }, 200_000);
    });

    100_000;
  });

  describe('build project dependencies too', () => {
    const app = uniq('demo');
    const lib = uniq('my-lib');
    beforeAll(() => {
      proj = newProject({
        name: uniq('vite-incr-build'),
        packages: ['@nx/react'],
      });
      runCLI(`generate @nx/react:app ${app} --bundler=vite --no-interactive`);
      runCLI(
        `generate @nx/react:lib ${lib}-buildable --unitTestRunner=none --bundler=vite --importPath="@acme/buildable" --no-interactive`
      );
      runCLI(
        `generate @nx/react:lib ${lib} --unitTestRunner=none --bundler=none --importPath="@acme/non-buildable" --no-interactive`
      );

      // because the default js lib builds as cjs it cannot be loaded from dist
      // so the paths plugin should always resolve to the libs source
      runCLI(
        `generate @nx/js:lib ${lib}-js --bundler=tsc --importPath="@acme/js-lib" --no-interactive`
      );
      const buildableLibCmp = names(`${lib}-buildable`).className;
      const nonBuildableLibCmp = names(lib).className;
      const buildableJsLibFn = names(`${lib}-js`).propertyName;

      updateFile(`apps/${app}/src/app/app.tsx`, () => {
        return `
import styles from './app.module.css';
import NxWelcome from './nx-welcome';
import { ${buildableLibCmp} } from '@acme/buildable';
import { ${buildableJsLibFn} } from '@acme/js-lib';
import { ${nonBuildableLibCmp} } from '@acme/non-buildable';

export function App() {
  return (
     <div>
       <${buildableLibCmp} />
       <${nonBuildableLibCmp} />
       <p>{${buildableJsLibFn}()}</p>
       <NxWelcome title='${app}' />
      </div>
  );
}
export default App;
`;
      });
    });

    afterAll(() => {
      cleanupProject();
    });

    it('should build app and libs too', () => {
      const results = runCLI(`build ${app}`);
      expect(results).toContain('Successfully ran target build for project');
      expect(results).toContain('40 modules transformed');
    });
  });

  describe('should be able to create libs that use vitest', () => {
    const lib = uniq('my-lib');
    beforeEach(() => {
      proj = newProject({ name: uniq('vite-proj'), packages: ['@nx/react'] });
    });

    it('should be able to run tests', async () => {
      runCLI(`generate @nx/react:lib ${lib} --unitTestRunner=vitest`);
      expect(exists(tmpProjPath(`libs/${lib}/vite.config.ts`))).toBeTruthy();

      const result = await runCLIAsync(`test ${lib}`);
      expect(result.combinedOutput).toContain(
        `Successfully ran target test for project ${lib}`
      );

      const nestedResults = await runCLIAsync(`test ${lib} --skip-nx-cache`, {
        cwd: `${tmpProjPath()}/libs/${lib}`,
      });
      expect(nestedResults.combinedOutput).toContain(
        `Successfully ran target test for project ${lib}`
      );
    }, 100_000);

    it('should collect coverage', () => {
      runCLI(`generate @nx/react:lib ${lib} --unitTestRunner=vitest`);
      updateFile(`libs/${lib}/vite.config.ts`, () => {
        return `/// <reference types='vitest' />
        import { defineConfig } from 'vite';
        import react from '@vitejs/plugin-react';
        import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
        
        export default defineConfig({
          root: __dirname,
          cacheDir: '../../node_modules/.vite/libs/${lib}',
          plugins: [react(), nxViteTsPaths()],
          test: {
            globals: true,
            cache: {
              dir: '../../node_modules/.vitest',
            },
            environment: 'jsdom',
            include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
            reporters: ['default'],
            coverage: {
              reportsDirectory: '../../coverage/libs/${lib}',
              provider: 'v8',
              enabled: true,
              thresholds: {
                lines: 100,
                statements: 100,
                functions: 100,
                branches: 1000,
              }
            },
          },
        });
        `;
      });

      const coverageDir = `${tmpProjPath()}/coverage/libs/${lib}`;

      const results = runCLI(`test ${lib} --coverage`, { silenceError: true });
      expect(results).toContain(
        `Running target test for project ${lib} failed`
      );
      expect(results).toContain(`ERROR: Coverage`);
      expect(directoryExists(coverageDir)).toBeTruthy();
    }, 100_000);

    it('should be able to run tests with inSourceTests set to true', async () => {
      runCLI(
        `generate @nx/react:lib ${lib} --unitTestRunner=vitest --inSourceTests`
      );
      expect(
        exists(tmpProjPath(`libs/${lib}/src/lib/${lib}.spec.tsx`))
      ).toBeFalsy();

      updateFile(`libs/${lib}/src/lib/${lib}.tsx`, (content) => {
        content += `
        if (import.meta.vitest) {
          const { expect, it } = import.meta.vitest;
          it('should be successful', () => {
            expect(1 + 1).toBe(2);
          });
        }
        `;
        return content;
      });

      const result = await runCLIAsync(`test ${lib}`);
      expect(result.combinedOutput).toContain(`1 passed`);
    }, 100_000);
  });

  describe('ESM-only apps', () => {
    beforeAll(() => {
      newProject({
        unsetProjectNameAndRootFormat: false,
        packages: ['@nx/react'],
      });
    });

    it('should support ESM-only plugins in vite.config.ts for root apps (#NXP-168)', () => {
      // ESM-only plugin to test with
      updateFile(
        'foo/package.json',
        JSON.stringify({
          name: '@acme/foo',
          type: 'module',
          version: '1.0.0',
          main: 'index.js',
        })
      );
      updateFile(
        'foo/index.js',
        `
        export default function fooPlugin() {
          return {
            name: 'foo-plugin',
            configResolved() {
              console.log('Foo plugin');
            }
          }
        }`
      );
      updateJson('package.json', (json) => {
        json.devDependencies['@acme/foo'] = 'file:./foo';
        return json;
      });
      runCommand(getPackageManagerCommand().install);

      const rootApp = uniq('root');
      runCLI(
        `generate @nx/react:app ${rootApp} --rootProject --bundler=vite --unitTestRunner=none --e2eTestRunner=none --style=css --no-interactive`
      );
      updateJson(`package.json`, (json) => {
        // This allows us to use ESM-only packages in vite.config.ts.
        json.type = 'module';
        return json;
      });
      updateFile(
        `vite.config.ts`,
        `
        import fooPlugin from '@acme/foo';
        import { defineConfig } from 'vite';
        import react from '@vitejs/plugin-react';
        import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
        
        export default defineConfig({
          cacheDir: '../../node_modules/.vite/root-app',
          server: {
            port: 4200,
            host: 'localhost',
          },
          plugins: [react(), nxViteTsPaths(), fooPlugin()],
        });`
      );

      runCLI(`build ${rootApp}`);

      checkFilesExist(`dist/${rootApp}/index.html`);
    });
  });
});
