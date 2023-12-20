import {
  CreateDependencies,
  CreateNodes,
  CreateNodesContext,
  detectPackageManager,
  NxJsonConfiguration,
  parseJson,
  readJsonFile,
  TargetConfiguration,
  writeJsonFile,
} from '@nx/devkit';
import { dirname, join } from 'path';

import { getNamedInputs } from '@nx/devkit/src/utils/get-named-inputs';
import { existsSync, readdirSync, readFileSync } from 'fs';

import { projectGraphCacheDirectory } from 'nx/src/utils/cache-directory';
import { calculateHashForCreateNodes } from '@nx/devkit/src/utils/calculate-hash-for-create-nodes';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { getLockFileName } from '@nx/js';

export interface NextPluginOptions {
  // TODO(jack): the design of this option will need to be revisited, but we do want to respect the user's package scripts.
  usePackageScripts?: boolean;
  buildTargetName?: string;
  devTargetName?: string;
  startTargetName?: string;
}

const cachePath = join(projectGraphCacheDirectory, 'next.hash');
const targetsCache = existsSync(cachePath) ? readTargetsCache() : {};

const calculatedTargets: Record<
  string,
  Record<string, TargetConfiguration>
> = {};

function readTargetsCache(): Record<
  string,
  Record<string, TargetConfiguration>
> {
  return readJsonFile(cachePath);
}

function writeTargetsToCache(
  targets: Record<string, Record<string, TargetConfiguration>>
) {
  writeJsonFile(cachePath, targets);
}

export const createDependencies: CreateDependencies = () => {
  writeTargetsToCache(calculatedTargets);
  return [];
};

// TODO(nicholas): Add support for .mjs files
export const createNodes: CreateNodes<NextPluginOptions> = [
  '**/next.config.{js, cjs}',
  async (configFilePath, options, context) => {
    options.usePackageScripts ??= true;
    const projectRoot = dirname(configFilePath);

    // Do not create a project if package.json and project.json isn't there.
    const siblingFiles = readdirSync(join(context.workspaceRoot, projectRoot));
    if (
      !siblingFiles.includes('package.json') &&
      !siblingFiles.includes('project.json')
    ) {
      return {};
    }

    options = normalizeOptions(options);

    const hash = calculateHashForCreateNodes(projectRoot, options, context, [
      getLockFileName(detectPackageManager(context.workspaceRoot)),
    ]);

    const targets =
      targetsCache[hash] ??
      (await buildNextTargets(configFilePath, projectRoot, options, context));

    calculatedTargets[hash] = targets;

    const result = {
      projects: {
        [projectRoot]: {
          root: projectRoot,
          targets,
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

async function buildNextTargets(
  nextConfigPath: string,
  projectRoot: string,
  options: NextPluginOptions,
  context: CreateNodesContext
) {
  const nextConfig = await getNextConfig(nextConfigPath, context);
  const nextOutputPath = await getOutputs(projectRoot, nextConfig);
  const namedInputs = getNamedInputs(projectRoot, context);

  const targets: Record<string, TargetConfiguration> = {};
  let targetsInferredFromPackageScripts = false;

  if (options.usePackageScripts) {
    const packageJson = parseJson(
      readFileSync(
        join(context.workspaceRoot, projectRoot, 'package.json'),
        'utf-8'
      )
    );
    const nextScriptRegexp = /(next\s+(?<cmd>\w+)|\bnext-remote-watch\b)/;

    // Need to wire up `dependsOn` for start to perform build first
    let startTargetName: string;
    let buildTargetName: string;

    if (packageJson.scripts) {
      targetsInferredFromPackageScripts = true;
      for (const [scriptName, script] of Object.entries(
        packageJson.scripts as Record<string, string>
      )) {
        // If script is `next build` then we need to configure input and outputs
        const match = nextScriptRegexp.exec(script);
        if (!match) continue;

        targets[scriptName] = {
          command: script,
          options: {
            cwd: projectRoot,
          },
        };

        if (match.groups?.cmd === 'build') {
          buildTargetName = scriptName;
          targets[scriptName].dependsOn = ['^build'];
          targets[scriptName].cache = true;
          targets[scriptName].inputs = getInputs(namedInputs);
          targets[scriptName].outputs = [
            nextOutputPath,
            `${nextOutputPath}/!(cache)`,
          ];
        } else if (match.groups?.cmd === 'start') {
          startTargetName = scriptName;
        }
      }

      if (buildTargetName && startTargetName) {
        targets[startTargetName].dependsOn = [buildTargetName];
      }
    }
  }

  if (!targetsInferredFromPackageScripts) {
    targets[options.buildTargetName] = {
      command: `next build`,
      options: {
        cwd: projectRoot,
      },
      dependsOn: ['^build'],
      cache: true,
      inputs: getInputs(namedInputs),
      outputs: [nextOutputPath, `${nextOutputPath}/!(cache)`],
    };

    targets[options.devTargetName] = {
      command: `next dev`,
      options: {
        cwd: projectRoot,
      },
    };

    targets[options.startTargetName] = {
      command: `next start`,
      options: {
        cwd: projectRoot,
      },
      dependsOn: [options.buildTargetName],
    };
  }

  return targets;
}

async function getOutputs(projectRoot, nextConfig) {
  let dir = '.next';

  if (typeof nextConfig === 'function') {
    // Works for both async and sync functions.
    const configResult = await Promise.resolve(
      nextConfig(PHASE_PRODUCTION_BUILD, { defaultConfig: {} })
    );
    if (configResult?.distDir) {
      dir = configResult?.distDir;
    }
  } else if (typeof nextConfig === 'object' && nextConfig?.distDir) {
    // If nextConfig is an object, directly use its 'distDir' property.
    dir = nextConfig.distDir;
  }
  return projectRoot === '.'
    ? `{projectRoot}/${dir}`
    : `{workspaceRoot}/${projectRoot}/${dir}`;
}

async function getNextConfig(
  configFilePath: string,
  context: CreateNodesContext
): Promise<any> {
  const resolvedPath = join(context.workspaceRoot, configFilePath);

  const module = await load(resolvedPath);
  return module.default ?? module;
}

function normalizeOptions(options: NextPluginOptions): NextPluginOptions {
  options ??= {};
  options.buildTargetName ??= 'build';
  options.devTargetName ??= 'dev';
  options.startTargetName ??= 'start';
  return options;
}

function getInputs(
  namedInputs: NxJsonConfiguration['namedInputs']
): TargetConfiguration['inputs'] {
  return [
    ...('production' in namedInputs
      ? ['default', '^production']
      : ['default', '^default']),
    {
      externalDependencies: ['next'],
    },
  ];
}

/**
 * Load the module after ensuring that the require cache is cleared.
 */
async function load(path: string): Promise<any> {
  if (path.endsWith('.js') || path.endsWith('.cjs')) {
    // Clear cache if the path is in the cache
    if (require.cache[path]) {
      for (const k of Object.keys(require.cache)) {
        delete require.cache[k];
      }
    }

    // Then require
    return require(path);
  } else {
    // TODO(nicholas): handle cache clear for ESM
    return await Function(`return import("${path}")`)();
  }
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
