import { Linter } from '@nrwl/workspace';

export interface StorybookUpgradeSchema {
  name: string;
  uiFramework: '@storybook/angular' | '@storybook/react';
}
