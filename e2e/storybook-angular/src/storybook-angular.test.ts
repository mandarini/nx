import {
  checkFilesExist,
  cleanupProject,
  getPackageManagerCommand,
  getSelectedPackageManager,
  isNotWindows,
  killPorts,
  runCLI,
  runCommand,
  runCreateWorkspace,
  runCypressTests,
  tmpProjPath,
  uniq,
} from '@nrwl/e2e/utils';
import { writeFileSync } from 'fs';

describe('Storybook for Angular', () => {
  const previousPM = process.env.SELECTED_PM;
  const packageManager = getSelectedPackageManager() || 'yarn';
  const proj = uniq('proj');
  const appName = uniq('app');

  beforeAll(() => {
    process.env.SELECTED_PM = 'yarn';
    runCreateWorkspace(proj, {
      preset: 'angular-monorepo',
      appName,
      style: 'css',
      packageManager,
    });

    runCLI(
      `generate @nrwl/angular:storybook-configuration ${appName} --generateStories --storybook7Configuration --no-interactive`
    );

    runCommand(getPackageManagerCommand().install);
  });

  afterAll(() => {
    cleanupProject();
    process.env.SELECTED_PM = previousPM;
  });

  describe('Storybook builder', () => {
    it('shoud build storybook', () => {
      runCLI(`run ${appName}:build-storybook --verbose`);
      checkFilesExist(`dist/storybook/${appName}/index.html`);
    });
  });

  describe('run cypress tests using storybook', () => {
    let angularStorybookLib;

    beforeAll(() => {
      angularStorybookLib = uniq('test-ui-lib');
      createTestUILib(angularStorybookLib);
      runCLI(
        `generate @nrwl/angular:storybook-configuration ${angularStorybookLib} --configureCypress --generateStories --generateCypressSpecs --no-interactive`
      );
    });

    it('should execute e2e tests using Cypress running against Storybook', async () => {
      if (isNotWindows() && runCypressTests()) {
        // TODO: need to fix the issue `ENOENT: no such file or directory` for below test-button.component.spec.ts
        writeFileSync(
          tmpProjPath(
            `apps/${angularStorybookLib}-e2e/src/e2e/test-button/test-button.component.cy.ts`
          ),
          `
          describe('${angularStorybookLib}, () => {

            it('should render the correct text', () => {
              cy.visit(
                '/iframe.html?id=testbuttoncomponent--primary&args=text:Click+me;color:#ddffdd;disabled:false;'
              )
              cy.get('button').should('contain', 'Click me');
              cy.get('button').should('not.be.disabled');
            });

            it('should adjust the controls', () => {
              cy.visit(
                '/iframe.html?id=testbuttoncomponent--primary&args=text:Click+me;color:#ddffdd;disabled:true;'
              )
              cy.get('button').should('be.disabled');
            });
          });
          `
        );

        const e2eResults = runCLI(`e2e ${angularStorybookLib}-e2e --no-watch`);
        expect(e2eResults).toContain('All specs passed!');
        expect(await killPorts()).toBeTruthy();
      }
    }, 1000000);
  });
});

export function createTestUILib(libName: string): void {
  runCLI(`g @nrwl/angular:library ${libName} --no-interactive`);
  runCLI(
    `g @nrwl/angular:component test-button --project=${libName} --no-interactive`
  );

  writeFileSync(
    tmpProjPath(`libs/${libName}/src/lib/test-button/test-button.component.ts`),
    `
    import { Component, Input } from '@angular/core';

    @Component({
      selector: 'proj-test-button',
      templateUrl: './test-button.component.html',
      styleUrls: ['./test-button.component.css'],
    })
    export class TestButtonComponent {
      @Input() text = 'Click me';
      @Input() color = '#ddffdd';
      @Input() disabled = false;
    }
      `
  );

  writeFileSync(
    tmpProjPath(
      `libs/${libName}/src/lib/test-button/test-button.component.html`
    ),
    `
    <button
    class="my-btn"
    [ngStyle]="{ backgroundColor: color }"
    [disabled]="disabled"
  >
    {{ text }}
  </button>
    `
  );
  runCLI(
    `g @nrwl/angular:component test-other --project=${libName} --no-interactive`
  );
}
