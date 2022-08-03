import { matchPathWithTemplateString } from './match-path-with-template-string';

describe('matchPathWithTemplateString', () => {
  test.each([
    {
      path: 'apps/test-ui-app/src/app/test-path/ignore-it/another-one.tsx',
      pathList: [
        '{projectRoot}/src/app/anothercmp/**/*.skip.*',
        '{workspaceRoot}/**/**/src/**/test-path/**',
      ],
      root: 'apps/test-ui-app',
      expected: true,
    },
    {
      path: 'libs/test-ui-lib/src/lib/test-path/ignore-it/another-one.tsx',
      pathList: ['{workspaceRoot}/**/**/src/**/test-path/**'],
      root: 'libs/test-ui-lib',
      expected: true,
    },
    {
      path: 'apps/test-2/src/app/ignore/one.skip.tsx',
      pathList: ['{projectRoot}/src/app/**/*.skip.*'],
      root: 'apps/test-2',
      expected: true,
    },
    {
      path: 'apps/test-2/src/app/ignore/one.skip.tsx',
      pathList: ['{workspaceRoot}/**/**/src/**/**/*.skip.*'],
      root: 'apps/test-2',
      expected: true,
    },
    {
      path: 'apps/test-2/src/app/other/two.skip.ts',
      pathList: ['{workspaceRoot}/**/**/src/**/**/*.skip.*'],
      root: 'apps/test-2',
      expected: true,
    },
    {
      path: 'libs/my-lib/src/lib/test/three.skip.ts',
      pathList: ['{projectRoot}/src/lib/**/*.skip.*'],
      root: 'libs/my-lib',
      expected: true,
    },
    {
      path: 'apps/test-ui-app/src/app/test-path/ignore-it/another-one.tsx',
      pathList: ['{projectRoot}/src/app/anothercmp/**/*.skip.*'],
      root: 'apps/test-ui-app',
      expected: false,
    },
    {
      path: 'libs/test-ui-lib/src/lib/test-path/ignore-it/another-one.tsx',
      pathList: ['{workspaceRoot}/apps/**/src/**/test-path/**'],
      root: 'libs/test-ui-lib',
      expected: false,
    },
    {
      path: '12341234',
      pathList: ['{workspaceRoot}/apps/**/src/**/test-path/**'],
      root: 'libs/test-ui-lib',
      expected: false,
    },
  ])(
    'check if $path should be ignored',
    ({ path, pathList, root, expected }) => {
      const result = matchPathWithTemplateString(path, pathList, root);
      expect(result).toBe(expected);
    }
  );

  it('should throw error if path is invalid', () => {
    expect(() => {
      matchPathWithTemplateString(
        'libs/test-ui-lib/src/lib/another-one.tsx',
        ['libs/test-ui-lib/src/lib/test-path/**'],
        'libs/test-ui-lib'
      );
    }).toThrowError(
      new Error(
        [
          `"libs/test-ui-lib/src/lib/test-path/**" in the provided path list is an invalid path.`,
          'All paths have to start with either {workspaceRoot} or {projectRoot}.',
          'For instance: "{projectRoot}/**/not-stories/**" or "{workspaceRoot}/**/**/not-stories/**".',
        ].join('\n')
      )
    );
  });
});
