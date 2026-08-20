import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import { createHtmlAssistantProcessor } from './html-assistant-processor';
import { createHtmlAssistantTaskDefinitionV1 } from './html-assistant-task-definition';

export const htmlAssistantMainFeature = Object.freeze({
  id: 'builtin.html.assistant',
  registerGenerationTaskDefinitions({ definitions }): void {
    definitions.register(
      createHtmlAssistantTaskDefinitionV1(createHtmlAssistantProcessor()),
    );
  },
} satisfies MainWorkbenchFeatureContribution);
