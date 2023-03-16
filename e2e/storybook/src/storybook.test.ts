import {
  checkFilesExist,
  cleanupProject,
  killPorts,
  runCLI,
  runCommandUntil,
  tmpProjPath,
  uniq,
  updateJson,
  getPackageManagerCommand,
  runCommand,
  getSelectedPackageManager,
  runCreateWorkspace,
} from '@nrwl/e2e/utils';
import { writeFileSync } from 'fs';

describe('Storybook generators for non-angular projects', () => {
  const previousPM = process.env.SELECTED_PM;

  let reactStorybookLib: string;
  const packageManager = getSelectedPackageManager() || 'yarn';
  const proj = uniq('proj');
  const appName = uniq('app');

  beforeAll(() => {
    process.env.SELECTED_PM = 'yarn';

    runCreateWorkspace(proj, {
      preset: 'react-monorepo',
      appName,
      style: 'css',
      packageManager,
      bundler: 'webpack',
    });

    reactStorybookLib = uniq('test-ui-lib-react');

    runCLI(`generate @nrwl/react:lib ${reactStorybookLib} --no-interactive`);
    runCLI(
      `generate @nrwl/react:storybook-configuration ${reactStorybookLib} --generateStories --no-interactive`
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

  describe('serve storybook', () => {
    afterEach(() => killPorts());

    it('should run a React based Storybook setup', async () => {
      // serve the storybook
      const p = await runCommandUntil(
        `run ${reactStorybookLib}:storybook`,
        (output) => {
          return /Storybook.*started/gi.test(output);
        }
      );
      p.kill();
    }, 1000000);
  });

  // TODO: Re-enable this test when Nx uses only Storybook 7 (Nx 16)
  // This fails for Node 18 because Storybook 6.5 uses webpack even in non-webpack projects
  // https://github.com/storybookjs/builder-vite/issues/414#issuecomment-1287536049
  // https://github.com/storybookjs/storybook/issues/20209
  // Error: error:0308010C:digital envelope routines::unsupported
  xdescribe('build storybook', () => {
    it('should build and lint a React based storybook', () => {
      // build
      runCLI(`run ${reactStorybookLib}:build-storybook --verbose`);
      checkFilesExist(`dist/storybook/${reactStorybookLib}/index.html`);

      // lint
      const output = runCLI(`run ${reactStorybookLib}:lint`);
      expect(output).toContain('All files pass linting.');
    }, 1000000);

    // I am not sure how much sense this test makes - Maybe it's just adding noise
    xit('should build a React based storybook that references another lib', () => {
      const anotherReactLib = uniq('test-another-lib-react');
      runCLI(`generate @nrwl/react:lib ${anotherReactLib} --no-interactive`);
      // create a React component we can reference
      writeFileSync(
        tmpProjPath(`libs/${anotherReactLib}/src/lib/mytestcmp.tsx`),
        `
        export function MyTestCmp() {
          return (
            <div>
              <h1>Welcome to OtherLib!</h1>
            </div>
          );
        }
        
        export default MyTestCmp;
        `
      );
      // update index.ts and export it
      writeFileSync(
        tmpProjPath(`libs/${anotherReactLib}/src/index.ts`),
        `
            export * from './lib/mytestcmp';
        `
      );

      // create a story in the first lib to reference the cmp from the 2nd lib
      writeFileSync(
        tmpProjPath(
          `libs/${reactStorybookLib}/src/lib/myteststory.stories.tsx`
        ),
        `
            import type { Meta } from '@storybook/react';
            import { MyTestCmp } from '@${proj}/${anotherReactLib}';

            const Story: Meta<typeof MyTestCmp> = {
              component: MyTestCmp,
              title: 'MyTestCmp',
            };
            export default Story;

            export const Primary = {
              args: {},
            };

        `
      );

      // build React lib
      runCLI(`run ${reactStorybookLib}:build-storybook --verbose`);
      checkFilesExist(`dist/storybook/${reactStorybookLib}/index.html`);
    }, 1000000);
  });
});
