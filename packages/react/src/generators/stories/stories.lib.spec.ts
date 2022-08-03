import { Tree } from '@nrwl/devkit';
import storiesGenerator from './stories';
import { createTreeWithEmptyWorkspace } from '@nrwl/devkit/testing';
import applicationGenerator from '../application/application';
import { Linter } from '@nrwl/linter';
import libraryGenerator from '../library/library';

describe('react:stories for libraries', () => {
  let appTree: Tree;

  beforeEach(async () => {
    appTree = await createTestUILib('test-ui-lib');

    // create another component
    appTree.write(
      'libs/test-ui-lib/src/lib/anothercmp/another-cmp.tsx',
      `import React from 'react';

      import './test.scss';

      export interface TestProps {
        name: string;
        displayAge: boolean;
      }

      export const Test = (props: TestProps) => {
        return (
          <div>
            <h1>Welcome to test component, {props.name}</h1>
          </div>
        );
      };

      export default Test;
      `
    );
  });

  it('should create the stories', async () => {
    await storiesGenerator(appTree, {
      project: 'test-ui-lib',
      generateCypressSpecs: false,
    });

    expect(
      appTree.exists('libs/test-ui-lib/src/lib/test-ui-lib.stories.tsx')
    ).toBeTruthy();
    expect(
      appTree.exists(
        'libs/test-ui-lib/src/lib/anothercmp/another-cmp.stories.tsx'
      )
    ).toBeTruthy();
  });

  it('should generate Cypress specs', async () => {
    await storiesGenerator(appTree, {
      project: 'test-ui-lib',
      generateCypressSpecs: true,
    });

    expect(
      appTree.exists(
        'apps/test-ui-lib-e2e/src/integration/test-ui-lib/test-ui-lib.spec.ts'
      )
    ).toBeTruthy();
    expect(
      appTree.exists(
        'apps/test-ui-lib-e2e/src/integration/another-cmp/another-cmp.spec.ts'
      )
    ).toBeTruthy();
  });

  it('should not overwrite existing stories', () => {});

  describe('ignore paths', () => {
    beforeEach(() => {
      appTree.write(
        'libs/test-ui-lib/src/lib/test-path/ignore-it/another-one.tsx',
        `import React from 'react';
  
    export interface IgnoreProps {
      name: string;
      displayAge: boolean;
    }
  
    export const Ignored = (props: IgnoreProps) => {
      return (
        <div>
          <h1>Welcome to test component, {props.name}</h1>
        </div>
      );
    };
  
    export default Ignored;
    `
      );

      appTree.write(
        'libs/test-ui-lib/src/lib/anothercmp/another-cmp.skip.tsx',
        `import React from 'react';
    
    export interface OtherTestProps {
      name: string;
      displayAge: boolean;
    }
  
    export const OtherTest = (props: OtherTestProps) => {
      return (
        <div>
          <h1>Welcome to test component, {props.name}</h1>
        </div>
      );
    };
  
    export default OtherTest;
    `
      );
    });
    it('should generate stories for all if no ignorePaths', async () => {
      await storiesGenerator(appTree, {
        project: 'test-ui-lib',
        generateCypressSpecs: false,
      });

      expect(
        appTree.exists(
          'libs/test-ui-lib/src/lib/anothercmp/another-cmp.stories.tsx'
        )
      ).toBeTruthy();

      expect(
        appTree.exists(
          'libs/test-ui-lib/src/lib/test-path/ignore-it/another-one.stories.tsx'
        )
      ).toBeTruthy();

      expect(
        appTree.exists(
          'libs/test-ui-lib/src/lib/anothercmp/another-cmp.skip.stories.tsx'
        )
      ).toBeTruthy();
    });

    it('should ignore entire paths', async () => {
      await storiesGenerator(appTree, {
        project: 'test-ui-lib',
        generateCypressSpecs: false,
        ignorePaths:
          '{projectRoot}/src/lib/anothercmp/**,{workspaceRoot}/**/**/src/**/test-path/ignore-it/**',
      });

      expect(
        appTree.exists(
          'libs/test-ui-lib/src/lib/anothercmp/another-cmp.stories.tsx'
        )
      ).toBeFalsy();

      expect(
        appTree.exists(
          'libs/test-ui-lib/src/lib/test-path/ignore-it/another-one.stories.tsx'
        )
      ).toBeFalsy();

      expect(
        appTree.exists(
          'libs/test-ui-lib/src/lib/anothercmp/another-cmp.skip.stories.tsx'
        )
      ).toBeFalsy();
    });

    it('should ignore path or a pattern', async () => {
      await storiesGenerator(appTree, {
        project: 'test-ui-lib',
        generateCypressSpecs: false,
        ignorePaths:
          '{projectRoot}/src/lib/anothercmp/**/*.skip.*,{workspaceRoot}/**/test-ui-lib/src/**/test-path/**',
      });

      expect(
        appTree.exists(
          'libs/test-ui-lib/src/lib/anothercmp/another-cmp.stories.tsx'
        )
      ).toBeTruthy();

      expect(
        appTree.exists(
          'libs/test-ui-lib/src/lib/test-path/ignore-it/another-one.stories.tsx'
        )
      ).toBeFalsy();

      expect(
        appTree.exists(
          'libs/test-ui-lib/src/lib/anothercmp/another-cmp.skip.stories.tsx'
        )
      ).toBeFalsy();
    });

    it('should throw an error for invalid pattern', async () => {
      await expect(
        storiesGenerator(appTree, {
          project: 'test-ui-lib',
          generateCypressSpecs: false,
          ignorePaths:
            'libs/test-ui-lib/src/lib/anothercmp/**/*.skip.*,{workspaceRoot}/**/**/src/**/test-path/**',
        })
      ).rejects.toEqual(
        new Error(
          [
            `"libs/test-ui-lib/src/lib/anothercmp/**/*.skip.*" is an invalid path.`,
            'All paths have to start with either {workspaceRoot} or {projectRoot}.',
            'For instance: "{projectRoot}/**/not-stories/**" or "{workspaceRoot}/**/**/not-stories/**".',
          ].join('\n')
        )
      );
    });
  });

  it('should ignore files that do not contain components', async () => {
    // create another component
    appTree.write(
      'libs/test-ui-lib/src/lib/some-utils.js',
      `export const add = (a: number, b: number) => a + b;`
    );

    await storiesGenerator(appTree, {
      project: 'test-ui-lib',
      generateCypressSpecs: false,
    });

    // should just create the story and not error, even though there's a js file
    // not containing any react component
    expect(
      appTree.exists('libs/test-ui-lib/src/lib/test-ui-lib.stories.tsx')
    ).toBeTruthy();
  });
});

export async function createTestUILib(
  libName: string,
  plainJS = false
): Promise<Tree> {
  let appTree = createTreeWithEmptyWorkspace();

  await libraryGenerator(appTree, {
    linter: Linter.EsLint,
    component: true,
    skipFormat: true,
    skipTsConfig: false,
    style: 'css',
    unitTestRunner: 'none',
    name: libName,
    standaloneConfig: false,
  });

  // create some Nx app that we'll use to generate the cypress
  // spec into it. We don't need a real Cypress setup

  await applicationGenerator(appTree, {
    e2eTestRunner: 'none',
    linter: Linter.EsLint,
    skipFormat: false,
    style: 'css',
    unitTestRunner: 'none',
    name: `${libName}-e2e`,
    js: plainJS,
    standaloneConfig: false,
  });
  return appTree;
}
