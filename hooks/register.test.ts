import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Job } from '../types'

import { CODEX_EXEC_SAMPLE } from './fixtures/codex-exec-sample'

const DELEGATE = 'mcp__pantheon__delegate'
const RESULT = 'mcp__pantheon__delegate_result'
const HOME = '/home/u'
const ROOT = '/repo'

type World = {
  files?: Record<string, string>
  realPaths?: Record<string, string>
  isRepo?: boolean
  stdout?: string
  exitCode?: number
}

function world(on: On, opts: World = {}) {
  const seen = {
    argv: [] as string[][],
    cwds: [] as string[],
    agents: [] as string[],
    tools: [] as string[],
    toasts: [] as string[],
    submits: [] as string[],
    gitRuns: 0,
  }
  const files = { ...(opts.files ?? {}) }
  const clock = mock.clock(on)
  mock.env(on, { HOME })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', async () => ({ value: ROOT }))
  on('process.run', async () => {
    seen.gitRuns++
    return opts.isRepo === false
      ? { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
      : { value: { exitCode: 0, stdout: `${ROOT}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', async (_$, e) => ({ value: Object.hasOwn(files, e.path) }))
  on('fs.read', async (_$, e) => ({ value: files[e.path] ?? '' }))
  on('fs.stat', async (_$, e) => ({
    value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath: opts.realPaths?.[e.path] ?? e.path },
  }))
  on('agent.register', async (_$, e) => { seen.agents.push(e.name); return { value: { agent: `pantheon:${e.name}` } } })
  on('tool.register', async (_$, e) => { seen.tools.push(e.name); return { value: { tool: `mcp__pantheon__${e.name}` } } })
  on('ui.toast', async (_$, e) => { seen.toasts.push(e.text); return { value: undefined } })
  on('process.spawn', async function* (_$, e) {
    seen.argv.push([...e.argv])
    seen.cwds.push(e.cwd ?? '')
    const text = opts.stdout ?? CODEX_EXEC_SAMPLE
    if (text) yield { stream: 'stdout' as const, text }
    return { value: { code: opts.exitCode ?? 0, signal: null } }
  })
  return { seen, files, clock }
}

async function start($: Engine) {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

function parse(out: unknown): Record<string, unknown> {
  const text = (out as { result?: unknown }).result
  return JSON.parse(typeof text === 'string' ? text : JSON.stringify(text))
}

describe('register', () => {
  test('session.start registers tools and native agents', async ($, on) => {
    const { seen } = world(on)
    await start($)
    expect(seen.tools).toEqual(['delegate', 'delegate_result', 'delegate_cancel'])
    expect(seen.agents).toEqual(['oracle', 'designer', 'councillor-beta'])
  })

  test('delegate runs codex through process.spawn hook and returns final message', async ($, on) => {
    const { seen } = world(on)
    await start($)
    const out = parse(await $.tool.call({ tool: DELEGATE, agent: 'explorer', prompt: 'find x' } as never))
    expect(out.status).toBe('done')
    expect(typeof out.result).toBe('string')
    expect(seen.argv[0]?.slice(0, 5)).toEqual(['codex', 'exec', '--json', '-s', 'read-only'])
    expect(seen.cwds[0]).toBe(ROOT)
  })

  test('delegate refuses while config is invalid', async ($, on) => {
    const { seen } = world(on, { files: { [`${HOME}/.claude/pantheon.json`]: '{ nope' } })
    await start($)
    const out = parse(await $.tool.call({ tool: DELEGATE, agent: 'explorer', prompt: 'x' } as never))
    expect(String(out.error)).toContain('inválida')
    expect(seen.argv).toEqual([])
    expect(seen.toasts.length).toBe(1)
  })

  test('skipGitRepoCheck is true only when git rev-parse fails', async ($, on) => {
    const { seen } = world(on, { isRepo: false })
    await start($)
    await $.tool.call({ tool: DELEGATE, agent: 'explorer', prompt: 'x' } as never)
    expect(seen.argv[0]).toContain('--skip-git-repo-check')
  })

  test('skipGitRepoCheck is absent inside a repository', async ($, on) => {
    const { seen } = world(on)
    await start($)
    await $.tool.call({ tool: DELEGATE, agent: 'explorer', prompt: 'x' } as never)
    expect(seen.argv[0]).not.toContain('--skip-git-repo-check')
  })

  test('cwd resolving outside the root is refused', async ($, on) => {
    const { seen } = world(on, { realPaths: { '/repo/link': '/etc' } })
    await start($)
    const out = parse(await $.tool.call({ tool: DELEGATE, agent: 'fixer', prompt: 'x', cwd: '/repo/link' } as never))
    expect(String(out.error)).toContain('fora')
    expect(seen.argv).toEqual([])
  })

  test('resume: unknown job and job without sessionId -> error', async ($, on) => {
    world(on, { stdout: '' , exitCode: 1 })
    await start($)
    const unknown = parse(await $.tool.call({ tool: DELEGATE, agent: 'fixer', prompt: 'x', resume: 'nope' } as never))
    expect(String(unknown.error)).toContain('desconhecido')
    const failed = parse(await $.tool.call({ tool: DELEGATE, agent: 'fixer', prompt: 'x' } as never))
    expect(failed.status).toBe('error')
    const again = parse(await $.tool.call({ tool: DELEGATE, agent: 'fixer', prompt: 'y', resume: failed.jobId } as never))
    expect(String(again.error)).toContain('delegar de novo')
  })

  test('resume ignores a new cwd and reuses the stored one', async ($, on) => {
    const { seen } = world(on)
    await start($)
    const first = parse(await $.tool.call({ tool: DELEGATE, agent: 'fixer', prompt: 'x', cwd: '/repo/sub' } as never))
    const moved = parse(await $.tool.call({ tool: DELEGATE, agent: 'fixer', prompt: 'y', resume: first.jobId, cwd: '/repo/other' } as never))
    expect(String(moved.error)).toContain('cwd gravado')
    const ok = parse(await $.tool.call({ tool: DELEGATE, agent: 'fixer', prompt: 'y', resume: first.jobId } as never))
    expect(ok.status).toBe('done')
    expect(seen.cwds).toEqual(['/repo/sub', '/repo/sub'])
    expect(seen.argv[1]).toContain('resume')
  })

  test('resume recomputes sandbox with a stricter current policy', async ($, on) => {
    const { seen, files } = world(on)
    await start($)
    const first = parse(await $.tool.call({ tool: DELEGATE, agent: 'fixer', prompt: 'x' } as never))
    expect(seen.argv[0]).toContain('workspace-write')
    files[`${ROOT}/.claude/pantheon.json`] = JSON.stringify({ sandboxCap: 'read-only' })
    await $.tool.call({ tool: DELEGATE, agent: 'fixer', prompt: 'y', resume: first.jobId } as never)
    expect(seen.argv[1]?.[4]).toBe('read-only')
  })

  test('resume revalidates the stored cwd before spawning', async ($, on) => {
    const realPaths: Record<string, string> = {}
    const { seen } = world(on, { realPaths })
    await start($)
    const first = parse(await $.tool.call({ tool: DELEGATE, agent: 'fixer', prompt: 'x', cwd: '/repo/sub' } as never))
    realPaths['/repo/sub'] = '/elsewhere'
    const out = parse(await $.tool.call({ tool: DELEGATE, agent: 'fixer', prompt: 'y', resume: first.jobId } as never))
    expect(String(out.error)).toContain('fora')
    expect(seen.argv.length).toBe(1)
  })

  test('delegate_result reads a finished job', async ($, on) => {
    world(on)
    await start($)
    const first = parse(await $.tool.call({ tool: DELEGATE, agent: 'explorer', prompt: 'x' } as never))
    const read = parse(await $.tool.call({ tool: RESULT, jobId: first.jobId } as never))
    expect(read.status).toBe('done')
    expect(read.result).toBe(first.result)
  })

  test('session.start marks leftover running/background jobs as lost', async ($, on) => {
    world(on)
    const saved: Job[] = [
      { id: 'a', agent: 'fixer', status: 'running', startedAt: 0, cwd: ROOT, sessionId: 's1' },
      { id: 'b', agent: 'explorer', status: 'background', startedAt: 0, cwd: ROOT },
      { id: 'c', agent: 'explorer', status: 'done', startedAt: 0, cwd: ROOT },
    ]
    let served = false
    on('state.get', async (_$, e, next) => {
      if (served || e.key !== 'jobs') return next(e)
      served = true
      return { value: { value: saved, version: 1 } }
    })
    await start($)
    const read = parse(await $.tool.call({ tool: RESULT, jobId: 'a' } as never))
    expect(read.status).toBe('lost')
    expect(read.isResumable).toBe(true)
    expect(parse(await $.tool.call({ tool: RESULT, jobId: 'b' } as never)).status).toBe('lost')
    expect(parse(await $.tool.call({ tool: RESULT, jobId: 'c' } as never)).status).toBe('done')
  })

  test('prompt.compose appends the orchestrator section last', async ($, on) => {
    world(on)
    on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' as const }] }))
    await start($)
    const out = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never)
    const last = out.sections[out.sections.length - 1]
    expect(last?.id).toBe('pantheon:orchestrator')
    expect(last?.scope).toBe('session')
    expect(last?.text).toContain('delegate')
  })

  test('valid config change re-registers native agents; invalid change does not', async ($, on) => {
    const { seen, files } = world(on)
    on('prompt.compose', async () => ({ sections: [] }))
    await start($)
    expect(seen.agents.length).toBe(3)
    files[`${HOME}/.claude/pantheon.json`] = JSON.stringify({ agents: { oracle: { model: 'sonnet' } } })
    await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never)
    expect(seen.agents.length).toBe(6)
    files[`${HOME}/.claude/pantheon.json`] = '{ broken'
    await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never)
    expect(seen.agents.length).toBe(6)
  })

  test('prompt.submit injects council block only for composer/bridge with trigger', async ($, on) => {
    world(on)
    const contexts: (readonly string[] | undefined)[] = []
    on('prompt.submit', async (_$, e) => { contexts.push(e.context); return { text: e.text, context: e.context } })
    await start($)
    await $.prompt.submit({ text: 'run a council on this', origin: { kind: 'composer' } } as never)
    await $.prompt.submit({ text: 'run a council on this', origin: { kind: 'sdk' } } as never)
    await $.prompt.submit({ text: 'fix the bug', origin: { kind: 'composer' } } as never)
    expect(String(contexts[0]?.join('\n'))).toContain('Council Mode')
    expect(contexts[1] ?? []).toEqual([])
    expect(contexts[2] ?? []).toEqual([])
  })

  test('agent.offer hides disabled pantheon agents', async ($, on) => {
    world(on, { files: { [`${HOME}/.claude/pantheon.json`]: JSON.stringify({ disabledAgents: ['oracle'] }) } })
    on('agent.offer', async () => ({ isOffered: true }))
    await start($)
    const offer = (agent: string) => $.agent.offer({ agent, description: '', source: 'plugin', provider: { plugin: 'pantheon', tier: 'user' } } as never)
    expect((await offer('pantheon:oracle')).isOffered).toBe(false)
    expect((await offer('pantheon:designer')).isOffered).toBe(true)
    expect((await offer('Explore')).isOffered).toBe(true)
  })

  test('background delegate returns at once and wakes the session when done', async ($, on) => {
    const { clock } = world(on)
    const texts: string[] = []
    on('prompt.submit', async (_$, e) => { texts.push(e.text); return { text: e.text } })
    await start($)
    const out = parse(await $.tool.call({ tool: DELEGATE, agent: 'explorer', prompt: 'x', background: true } as never))
    expect(out.status).toBe('background')
    await clock.settle()
    const done = parse(await $.tool.call({ tool: RESULT, jobId: out.jobId } as never))
    expect(done.status).toBe('done')
    expect(texts.some(text => text.includes(String(out.jobId)) && text.includes('delegate_result'))).toBe(true)
  })
})
