import { Rule } from '@angular-devkit/schematics';
import { Linter } from '@nrwl/workspace';

import { StorybookUpgradeSchema } from './schema';

export default function (rawSchema: StorybookUpgradeSchema): Rule {
  const schema = normalizeSchema(rawSchema);
  return {} as Rule;
}

function normalizeSchema(schema: StorybookUpgradeSchema) {
  const defaults = {
    linter: Linter.TsLint,
    js: false,
  };
  return {
    ...defaults,
    ...schema,
  };
}

// nx run @nrwl/storybook:upgrade-5-to-6

/**
 * Check workspace.json for
 *     "storybook": {
          "builder": "@nrwl/storybook:storybook",


           "config": {
              "configFolder": "libs/ui-test/.storybook"
            }


    1. Delete upgrade folder from React
    2. Add upgrade to collection.json
    3. Use nx/packages/angular/src/schematics/move/lib/update-module-name.ts file to copy the logic
            of copying and creating and moving and renaming and editing files
    4. In workspaceJson (how to read it: see in step 3) check all the apps for "storybook" "builder" to be 
         "@nrwl/storybook:storybook" and then get the configFolder path. Then you have the path of the files
         that need to be migrated.
 */