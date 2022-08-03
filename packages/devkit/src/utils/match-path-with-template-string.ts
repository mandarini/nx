/**
 * This function checks if a provided path is included in the pathList.
 * It matches the provided path against the pathList and returns true if it matches.
 * It uses the format of the inputs, all paths must start
 * with either {workspaceRoot} or {projectRoot}.
 *
 * @param path the path of the file to check against the provided path list
 * @param pathList the list of paths - all paths must start
 *                 with either {workspaceRoot} or {projectRoot}
 * @param projectRoot the root of the current project
 * @returns boolean indicating if the path is included in the path list
 */

import minimatch = require('minimatch');

export function matchPathWithTemplateString(
  path: string,
  pathList: string[],
  projectRoot: string
): boolean {
  return pathList.some((pattern) => {
    if (
      !pattern.startsWith('{projectRoot}/') &&
      !pattern.startsWith('{workspaceRoot}/')
    ) {
      throw new Error(
        [
          `"${pattern}" in the provided path list is an invalid path.`,
          'All paths have to start with either {workspaceRoot} or {projectRoot}.',
          'For instance: "{projectRoot}/**/not-stories/**" or "{workspaceRoot}/**/**/not-stories/**".',
        ].join('\n')
      );
    } else {
      return minimatch(
        path,
        pattern.startsWith('{projectRoot}/')
          ? pattern.replace('{projectRoot}', projectRoot)
          : pattern.substring(16)
      );
    }
  });
}
