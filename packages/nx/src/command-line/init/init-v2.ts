import { existsSync } from 'fs';
import { sync } from 'glob';
import { PackageJson } from '../../utils/package-json';
import { prerelease } from 'semver';
import { output } from '../../utils/output';
import { getPackageManagerCommand } from '../../utils/package-manager';
import { generateDotNxSetup } from './implementation/dot-nx/add-nx-scripts';
import { runNxSync } from '../../utils/child-process';
import { readJsonFile } from '../../utils/fileutils';
import { nxVersion } from '../../utils/versions';
import {
  addDepsToPackageJson,
  askAboutNxCloud,
  createNxJsonFile,
  runInstall,
  updateGitIgnore,
} from './implementation/utils';
import { prompt } from 'enquirer';
import { execSync } from 'child_process';

export interface InitArgs {
  // addE2e: boolean;
  // force: boolean;
  // integrated: boolean;
  interactive: boolean;
  // vite: boolean;
  nxCloud?: boolean;
  // cacheable?: string[];
  useDotNxInstallation?: boolean;
}

export async function initHandler(options: InitArgs) {
  const version =
    process.env.NX_VERSION ?? (prerelease(nxVersion) ? 'next' : 'latest');
  if (process.env.NX_VERSION) {
    output.log({ title: `Using version ${process.env.NX_VERSION}` });
  }
  if (existsSync('package.json') && !options.useDotNxInstallation) {
    const repoRoot = process.cwd();
    const cacheableOperations: string[] = [];
    createNxJsonFile(repoRoot, [], cacheableOperations, {});

    const pmc = getPackageManagerCommand();

    updateGitIgnore(repoRoot);

    const plugins = await detectPlugins();

    const useNxCloud =
      options.nxCloud ??
      (options.interactive ? await askAboutNxCloud() : false);

    addDepsToPackageJson(repoRoot, plugins);

    output.log({ title: '📦 Installing Nx' });

    runInstall(repoRoot, pmc);

    if (plugins) {
      output.log({ title: '🔨 Configuring plugins' });
      for (const plugin of plugins) {
        execSync(
          `${pmc.exec} nx g ${plugin}:init --skipPackageJson --no-interactive`,
          {
            stdio: [0, 1, 2],
            cwd: repoRoot,
          }
        );
      }
    }

    if (useNxCloud) {
      output.log({ title: '🛠️ Setting up Nx Cloud' });
      execSync(
        `${pmc.exec} nx g nx:connect-to-nx-cloud --installationSource=nx-init-pcv3 --quiet --no-interactive`,
        {
          stdio: [0, 1, 2],
          cwd: repoRoot,
        }
      );
    }
  } else {
    if (process.platform !== 'win32') {
      console.log(
        'Setting Nx up installation in `.nx`. You can run nx commands like: `./nx --help`'
      );
    } else {
      console.log(
        'Setting Nx up installation in `.nx`. You can run nx commands like: `./nx.bat --help`'
      );
    }
    generateDotNxSetup(version);
    // invokes the wrapper, thus invoking the initial installation process
    runNxSync('');
  }
}

async function detectPlugins(): Promise<undefined | string[]> {
  const files = ['package.json'].concat(
    sync('{apps,packages,libs}/**/*/package.json')
  );
  const detectedPlugins = new Set<string>();
  for (const file of files) {
    if (!existsSync(file)) continue;

    let packageJson: PackageJson;
    try {
      packageJson = readJsonFile(file);
    } catch {
      // Could have malformed JSON for unit tests, etc.
      continue;
    }

    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    // Generic JS tools
    if (deps['eslint']) {
      detectedPlugins.add('@nx/eslint');
    }
    // Bundlers
    if (deps['vite'] || deps['vitest']) {
      detectedPlugins.add('@nx/vite');
    }
    if (deps['webpack']) {
      detectedPlugins.add('@nx/webpack');
    }
    // Testing tools
    if (deps['jest']) {
      detectedPlugins.add('@nx/jest');
    }
    if (deps['cypress']) {
      detectedPlugins.add('@nx/cypress');
    }
    if (deps['playwright']) {
      detectedPlugins.add('@nx/playwright');
    }
    // Frameworks
    if (deps['@nestjs/core'] && deps['@nestjs/cli']) {
      detectedPlugins.add('@nx/nest');
    }
    if (deps['next']) {
      detectedPlugins.add('@nx/next');
    }
    if (deps['nuxt']) {
      detectedPlugins.add('@nx/nuxt');
    }
    if (deps['remix']) {
      detectedPlugins.add('@nx/remix');
    }
  }

  const plugins = Array.from(detectedPlugins);

  output.log({
    title: 'Nx plugins',
    bodyLines: [
      `These plugins can automatically configure your workspace:`,
      ...plugins.map((p) => `- ${p}`),
      `Learn more at https://nx.dev/concepts/plugins`,
    ],
  });

  const pluginsToInstall = await prompt<{ plugins: string[] }>([
    {
      name: 'plugins',
      type: 'multiselect',
      message: `Which plugins would you like to add?`,
      choices: plugins.map((p) => ({ name: p, value: p })),
    },
  ]).then((r) => r.plugins);

  return pluginsToInstall?.length > 0 ? pluginsToInstall : undefined;
}
