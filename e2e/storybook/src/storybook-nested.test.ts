import {
  checkFilesExist,
  cleanupProject,
  getPackageManagerCommand,
  getSelectedPackageManager,
  killPorts,
  readJson,
  runCLI,
  runCommand,
  runCommandUntil,
  runCreateWorkspace,
  tmpProjPath,
  uniq,
  updateJson,
} from '@nrwl/e2e/utils';
import { writeFileSync } from 'fs';

describe('Storybook generators for nested workspaces', () => {
  const previousPM = process.env.SELECTED_PM;
  const wsName = uniq('react');
  const appName = uniq('app');
  const packageManager = getSelectedPackageManager() || 'yarn';

  beforeAll(() => {
    process.env.SELECTED_PM = 'yarn';

    // create a workspace with a single react app at the root
    runCreateWorkspace(wsName, {
      preset: 'react-standalone',
      appName,
      style: 'css',
      packageManager,
      bundler: 'vite',
    });

    runCLI(
      `generate @nrwl/react:storybook-configuration ${appName} --generateStories --no-interactive --storybook7Configuration`
    );

    // TODO(jack): Overriding enhanced-resolve to 5.10.0 now until the package is fixed.
    // See: https://github.com/webpack/enhanced-resolve/issues/362
    updateJson('package.json', (json) => {
      json['overrides'] = {
        'enhanced-resolve': '5.10.0',
      };

      return json;
    });

    runCommand(getPackageManagerCommand().install);
  });

  afterAll(() => {
    cleanupProject();
    process.env.SELECTED_PM = previousPM;
  });

  describe('Storybook generated files', () => {
    it('should generate storybook files', () => {
      checkFilesExist(
        '.storybook/main.js',
        '.storybook/preview.js',
        '.storybook/tsconfig.json'
      );
    });

    it('should edit root tsconfig.json', () => {
      const tsconfig = readJson(`tsconfig.json`);
      expect(tsconfig['ts-node']?.compilerOptions?.module).toEqual('commonjs');
    });

    it('should generate correct files for nested app', () => {
      const nestedAppName = uniq('other-app');
      runCLI(`generate @nrwl/react:app ${nestedAppName} --no-interactive`);
      runCLI(
        `generate @nrwl/react:storybook-configuration ${nestedAppName} --generateStories --no-interactive --storybook7Configuration`
      );
      checkFilesExist(
        `apps/${nestedAppName}/.storybook/main.js`,
        `apps/${nestedAppName}/.storybook/tsconfig.json`
      );
    });
  });

  describe('serve storybook', () => {
    afterEach(() => killPorts());

    it('should run a React based Storybook setup', async () => {
      // serve the storybook
      const p = await runCommandUntil(`run ${appName}:storybook`, (output) => {
        return /Storybook.*started/gi.test(output);
      });
      p.kill();
    }, 1000000);
  });

  describe('build storybook', () => {
    it('should build and lint a React based storybook', () => {
      // build
      runCLI(`run ${appName}:build-storybook --verbose`);
      checkFilesExist(`dist/storybook/${appName}/index.html`);

      // lint
      const output = runCLI(`run ${appName}:lint`);
      expect(output).toContain('All files pass linting.');
    }, 1000000);

    // Not sure how much sense this test makes - maybe it's noise?
    xit('should build a React based storybook that references another lib', () => {
      const reactLib = uniq('test-lib-react');
      runCLI(`generate @nrwl/react:lib ${reactLib} --no-interactive`);
      // create a React component we can reference
      writeFileSync(
        tmpProjPath(`${reactLib}/src/lib/mytestcmp.tsx`),
        `
            import React from 'react';

            /* eslint-disable-next-line */
            export interface MyTestCmpProps {}

            export const MyTestCmp = (props: MyTestCmpProps) => {
              return (
                <div>
                  <h1>Welcome to test cmp!</h1>
                </div>
              );
            };

            export default MyTestCmp;
        `
      );
      // update index.ts and export it
      writeFileSync(
        tmpProjPath(`${reactLib}/src/index.ts`),
        `
            export * from './lib/mytestcmp';
        `
      );

      // create a story in the first lib to reference the cmp from the 2nd lib
      writeFileSync(
        tmpProjPath(`${reactLib}/src/lib/myteststory.stories.tsx`),
        `
            import React from 'react';

            import { MyTestCmp, MyTestCmpProps } from '@${wsName}/${reactLib}';

            export default {
              component: MyTestCmp,
              title: 'MyTestCmp',
            };

            export const primary = () => {
              /* eslint-disable-next-line */
              const props: MyTestCmpProps = {};

              return <MyTestCmp />;
            };
        `
      );

      // build React lib
      runCLI(`run ${reactLib}:build-storybook --verbose`);
      checkFilesExist(`dist/storybook/${reactLib}/index.html`);
    }, 1000000);
  });
});
