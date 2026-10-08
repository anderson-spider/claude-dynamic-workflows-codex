import { expect, test } from 'claude-code/testing'
import { DEFAULT_CONFIG } from './defaults'
import { CODEX_EXEC_SAMPLE } from './fixtures/codex-exec-sample'

test('shared modules load', () => {
  expect(DEFAULT_CONFIG.agents.fixer.model).toBe('gpt-6-luna')
  expect(CODEX_EXEC_SAMPLE).toContain('thread.started')
})
