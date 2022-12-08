import { addDependenciesToPackageJson, Tree } from '@nrwl/devkit';
import { createTreeWithEmptyV1Workspace } from '@nrwl/devkit/testing';
import { mockViteReactAppGenerator } from '../../utils/test-utils';
import {
  getTsSourceFile,
  removeProjectsFromViteTsConfigPaths,
} from './update-vite-tsconfig-paths';

describe('remove projects from vite-tsconfig-paths', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyV1Workspace();
    mockViteReactAppGenerator(tree);
    const existing = 'existing';
    const existingVersion = '1.0.0';
    addDependenciesToPackageJson(
      tree,
      { 'vite-tsconfig-paths': '^3.6.0', [existing]: existingVersion },
      { [existing]: existingVersion }
    );
  });

  it('should remove the projects attribute from vite-tsconfig-paths', async () => {
    await removeProjectsFromViteTsConfigPaths(tree);

    const file = getTsSourceFile(
      tree,
      'apps/my-test-react-vite-app/vite.config.ts'
    );

    expect(file.getText().includes('tsconfig.base.json')).toBeFalsy();
    expect(file.getText().includes('projects')).toBeFalsy();
  });
});
