import { resolveTemplatePath } from './resolve-template-path';

describe('matchPathWithTemplateString', () => {
  test.each([
    {
      path: '{projectRoot}/src/app/anothercmp/**/*.skip.*',
      projectRoot: 'apps/test-ui-app',
      expected: 'apps/test-ui-app/src/app/anothercmp/**/*.skip.*',
    },
    {
      path: '{workspaceRoot}/libs/test-ui-lib/src/lib/test-path/ignore-it/another-one.tsx',
      projectRoot: 'libs/test-ui-lib',
      expected: 'libs/test-ui-lib/src/lib/test-path/ignore-it/another-one.tsx',
    },
    {
      path: '{projectRoot}/src/app/ignore/one.skip.tsx',
      projectRoot: 'apps/test-2',
      expected: 'apps/test-2/src/app/ignore/one.skip.tsx',
    },
  ])('resolve path', ({ path, projectRoot, expected }) => {
    const result = resolveTemplatePath(path, projectRoot);
    expect(result).toBe(expected);
  });

  it('should throw error if path is invalid', () => {
    expect(() => {
      resolveTemplatePath(
        'libs/test-ui-lib/src/lib/another-one.tsx',
        'libs/test-ui-lib'
      );
    }).toThrowError(
      new Error(
        [
          `"libs/test-ui-lib/src/lib/another-one.tsx" is an invalid path.`,
          'All paths have to start with either {workspaceRoot} or {projectRoot}.',
          'For instance: "{projectRoot}/**/not-stories/**" or "{workspaceRoot}/**/**/not-stories/**".',
        ].join('\n')
      )
    );
  });
});
