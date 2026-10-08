// Contrato do $.state do Pantheon (autocontido: sem imports).

export type JobStatus = 'running' | 'background' | 'done' | 'error' | 'cancelled' | 'lost'
export type Tokens = { input: number; cached: number; output: number }
export type Job = {
  id: string; agent: string; description?: string; model?: string; status: JobStatus
  startedAt: number; endedAt?: number; cwd: string; sessionId?: string
  lastActivity?: string; tokens?: Tokens; result?: string; error?: string
}

declare module 'claude-code' {
  interface PluginState {
    pantheon: { jobs: Job[] }
  }
}
