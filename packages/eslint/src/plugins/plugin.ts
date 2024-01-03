import {
  CreateNodes,
  CreateNodesContext,
  parseJson,
  TargetConfiguration,
} from '@nx/devkit';
import { dirname, join } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { combineGlobPatterns } from 'nx/src/utils/globs';
import {
  ESLINT_CONFIG_FILENAMES,
  findBaseEslintFile,
  isFlatConfig,
} from '../utils/config-file';

export interface EslintPluginOptions {
  // TODO(jack): the design of this option will need to be revisited, but we do want to respect the user's package scripts.
  usePackageScripts?: boolean;
  targetName?: string;
}

export const createNodes: CreateNodes<EslintPluginOptions> = [
  combineGlobPatterns(['**/project.json', '**/package.json']),
  (configFilePath, options, context) => {
    const projectRoot = dirname(configFilePath);
    options = normalizeOptions(options);
    options.usePackageScripts ??= true;

    const eslintConfigs = getEslintConfigsForProject(
      projectRoot,
      context.workspaceRoot
    );
    if (!eslintConfigs.length) {
      return {};
    }

    const result = {
      projects: {
        [projectRoot]: {
          targets: buildEslintTargets(
            eslintConfigs,
            projectRoot,
            options,
            context
          ),
        },
      },
    };
    // For root projects, the name is not inferred from root package.json, so we need to manually set it.
    // TODO(jack): We should handle this in core and remove this workaround.
    if (projectRoot === '.') {
      result.projects[projectRoot]['name'] = buildProjectName(
        projectRoot,
        context.workspaceRoot
      );
    }
    return result;
  },
];

function getEslintConfigsForProject(
  projectRoot: string,
  workspaceRoot: string
): string[] {
  const detectedConfigs = new Set<string>();
  const baseConfig = findBaseEslintFile(workspaceRoot);
  if (baseConfig) {
    detectedConfigs.add(baseConfig);
  }

  let siblingFiles = readdirSync(join(workspaceRoot, projectRoot));

  if (projectRoot === '.') {
    // If there's no src folder, it's not a standalone project
    if (!siblingFiles.includes('src')) {
      return [];
    }
    // If it's standalone but doesn't have eslint config, it's not a lintable
    const config = siblingFiles.find((f) =>
      ESLINT_CONFIG_FILENAMES.includes(f)
    );
    if (!config) {
      return [];
    }
    detectedConfigs.add(config);
    return Array.from(detectedConfigs);
  }
  while (projectRoot !== '.') {
    // if it has an eslint config it's lintable
    const config = siblingFiles.find((f) =>
      ESLINT_CONFIG_FILENAMES.includes(f)
    );
    if (config) {
      detectedConfigs.add(`${projectRoot}/${config}`);
      return Array.from(detectedConfigs);
    }
    projectRoot = dirname(projectRoot);
    siblingFiles = readdirSync(join(workspaceRoot, projectRoot));
  }
  // check whether the root has an eslint config
  const config = readdirSync(workspaceRoot).find((f) =>
    ESLINT_CONFIG_FILENAMES.includes(f)
  );
  if (config) {
    detectedConfigs.add(config);
    return Array.from(detectedConfigs);
  }
  return [];
}

function buildEslintTargets(
  eslintConfigs: string[],
  projectRoot: string,
  options: EslintPluginOptions,
  context: CreateNodesContext
) {
  const isRootProject = projectRoot === '.';

  const targets: Record<string, TargetConfiguration> = {};

  const baseTargetConfig: TargetConfiguration = {
    command: `eslint ${isRootProject ? './src' : '.'}`,
    options: {
      cwd: projectRoot,
    },
  };
  if (eslintConfigs.some((config) => isFlatConfig(config))) {
    baseTargetConfig.options.env = {
      ESLINT_USE_FLAT_CONFIG: 'true',
    };
  }

  targets[options.targetName] = {
    ...baseTargetConfig,
    cache: true,
    inputs: [
      'default',
      ...eslintConfigs.map((config) => `{workspaceRoot}/${config}`),
      '{workspaceRoot}/tools/eslint-rules/**/*',
      { externalDependencies: ['eslint'] },
    ],
    options: {
      ...baseTargetConfig.options,
    },
  };

  return targets;
}

function normalizeOptions(options: EslintPluginOptions): EslintPluginOptions {
  options ??= {};
  options.targetName ??= 'lint';
  return options;
}

function buildProjectName(projectRoot: string, workspaceRoot: string): string {
  const packageJsonPath = join(workspaceRoot, projectRoot, 'package.json');
  let name: string;
  if (existsSync(packageJsonPath)) {
    const packageJson = parseJson(readFileSync(packageJsonPath, 'utf-8'));
    name = packageJson.name;
  }
  return name ?? projectRoot;
}
