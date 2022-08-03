/**
 *
 * @param path path in the format of {projectRoot}/src/dir/**
 *             or {workspaceRoot}/apps/**
 * @param projectRoot the root of the current project
 * @returns normalized path - replaces {projectRoot} with the actual path
 */

export function resolveTemplatePath(
  path: string,
  projectRoot?: string
): string {
  if (
    !path.startsWith('{projectRoot}/') &&
    !path.startsWith('{workspaceRoot}/')
  ) {
    throw new Error(
      [
        `"${path}" is an invalid path.`,
        'All paths have to start with either {workspaceRoot} or {projectRoot}.',
        'For instance: "{projectRoot}/**/not-stories/**" or "{workspaceRoot}/**/**/not-stories/**".',
      ].join('\n')
    );
  } else {
    console.log('GOT PATH:', path);
    console.log('GOT PROJECT ROOT:', projectRoot);
    console.log(
      'Return:',
      path.startsWith('{projectRoot}/')
        ? path.replace('{projectRoot}', projectRoot)
        : path.substring(16)
    );
    return path.startsWith('{projectRoot}/')
      ? path.replace('{projectRoot}', projectRoot)
      : path.substring(16);
  }
}
