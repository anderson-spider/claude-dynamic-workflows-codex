# Pantheon: mod do Claude Code no estilo oh-my-opencode-slim

Data: 2026-10-08 · Branch: `andersonsilva/pantheon-mod`

## Objetivo

Transformar este repositório num mod do Claude Code (plugin de function hooks) chamado
`pantheon`, que reproduz o modelo do oh-my-opencode-slim: a sessão do Claude é o
orchestrator e delega para especialistas, uns rodando no Codex (`codex exec`), outros como
subagentes Claude. Sem CLI, sem DSL de workflow, sem viewers.

Critérios de sucesso:

- Com o mod instalado, o Claude decide sozinho quando delegar, guiado por uma seção de
  system prompt adaptada do `orchestrator.ts` do slim, e chama `mcp__pantheon__delegate`.
- Delegações curtas voltam na própria chamada; longas viram job em background e acordam
  a sessão ao terminar.
- `/pantheon` mostra o progresso de todos os jobs da sessão.
- Uma mensagem com gatilho de council (`council`, `consenso`...) dispara a consulta em
  paralelo aos conselheiros e a síntese no formato do slim.
- Teto de sandbox preservado: o mais restritivo vence, `danger-full-access` recusado.

Fora de escopo: fallback de modelo, Observer, limite de concorrência, persistência de jobs
entre sessões, viewers HTML/ASCII, `--frontier`, steer de agente em execução.

## Referências

- oh-my-opencode-slim (MIT), clonado em `~/dev/tools/oh-my-opencode-slim` @ `73739208`:
  `src/agents/orchestrator.ts`, `role-routing.ts`, `role-prompts.ts`, `council.ts`,
  `src/hooks/council-inject/index.ts`, `docs/council.md`. Crédito no README.
- API de mods: tipos do engine (`claude-code.d.ts`) e `reference.md` da skill
  plugin-authoring.
- Amostra real de `codex exec --json` (codex-cli 0.161.0):
  `docs/superpowers/fixtures/codex-exec-sample.jsonl`.

## O que sai do repositório

`runner/`, `bin/`, `examples/`, `references/`, `SKILL.md`, `scripts/sync-skill.js`,
`docs/` (screenshots dos viewers; ficam só `docs/superpowers/`), `.claude/agents/`
(papéis migram para o mod), `package.json` atual (scripts do runner) e o conteúdo atual
de `.claude-plugin/`. `README.md`, `CONTRIBUTING.md` e `.github/workflows/ci.yml` são
reescritos.

Do runner, só a lógica é portada (não o código): teto de sandbox (`roles.js`),
carregamento e merge de papéis (`agentTypes.js`), precedência de modelo (`modelMap.js`,
sem frontier e sem família→modelo).

## Estrutura

```
.claude-plugin/plugin.json        name "pantheon", types ./types/index.d.ts
.claude-plugin/marketplace.json   o próprio repo como marketplace
hooks/hooks.json                  { "modules": ["./register.tsx"] }
hooks/register.tsx                liga eventos: session.start, tool.call, prompt.compose,
                                  prompt.submit, agent.offer, turn.complete, command.run,
                                  ui.render
hooks/config.ts                   padrões embutidos + ~/.claude/pantheon.json +
                                  <repo>/.claude/pantheon.json; validação
hooks/roles.ts                    definição dos papéis, teto de sandbox, resolução de modelo
hooks/prompts/orchestrator.ts     seção de system prompt (função pura da config)
hooks/prompts/roles.ts            prompts de cada papel (de role-prompts.ts)
hooks/prompts/council.ts          gatilho + bloco Council Mode (de council-inject)
hooks/codex.ts                    argv do codex exec; parser de JSONL → eventos de job
hooks/claude.ts                   spawn de papel Claude via $.agent.spawn
hooks/jobs.ts                     estado dos jobs, foreground→background, cancelamento
hooks/pane.tsx                    painel /pantheon e linha de status
types/index.d.ts                  contrato do $.state (pantheon.jobs)
hooks/*.test.ts                   testes (claude plugin test)
```

## Papéis

| Papel | Motor padrão | Modelo padrão | Sandbox / ferramentas |
|---|---|---|---|
| orchestrator | sessão principal | o da sessão | — |
| explorer | codex | `gpt-6-luna` | `read-only` |
| librarian | codex | `gpt-6-luna` | `read-only` (rede conforme config) |
| fixer | codex | `gpt-6-luna` | `workspace-write` |
| oracle | claude | `opus` | Read, Grep, Glob |
| designer | claude | herda | todas |
| councillor:\<seat\> | por seat | por seat | codex `read-only` / claude Read, Grep, Glob |

Todo papel tem `engine: "codex" | "claude"` trocável na config. Para papéis Claude,
`sandbox` não se aplica; vale a lista de ferramentas do agente.

## Configuração

Arquivo `~/.claude/pantheon.json`, sobrescrito campo a campo por
`<repo>/.claude/pantheon.json`. Lido via `$.fs` a cada `delegate` (mudanças valem sem
reload) e no `session.start` / a cada turno para montar o system prompt. Os valores abaixo
são os padrões embutidos; o arquivo só precisa do que muda.

```json
{
  "sandboxCap": "workspace-write",
  "noNetwork": false,
  "foregroundMinutes": 5,
  "disabledAgents": [],
  "agents": {
    "explorer":  { "engine": "codex",  "model": "gpt-6-luna", "sandbox": "read-only" },
    "librarian": { "engine": "codex",  "model": "gpt-6-luna", "sandbox": "read-only" },
    "fixer":     { "engine": "codex",  "model": "gpt-6-luna", "sandbox": "workspace-write" },
    "oracle":    { "engine": "claude", "model": "opus" },
    "designer":  { "engine": "claude" }
  },
  "council": {
    "seats": {
      "alpha": { "engine": "codex",  "model": "gpt-6-astra", "effort": "high" },
      "beta":  { "engine": "claude", "model": "opus" }
    }
  }
}
```

- Cada papel/seat aceita `model`, `effort` (Codex: `-c model_reasoning_effort=…`) e
  `prompt` (acrescentado ao fim do prompt do papel, como o `customAppendPrompt` do slim).
- `disabledAgents` aceita nomes de papel e `"council"` (desliga gatilho, seats e menção
  no system prompt).
- Sandbox efetivo = o mais restritivo entre o do papel e `sandboxCap`
  (`read-only` < `workspace-write`). `danger-full-access` é recusado em qualquer lugar.
- `noNetwork: true` passa `-c sandbox_workspace_write.network_access=false`.
- Config inválida: toast com o erro, mod segue com os padrões.

## Ferramentas (`$.tool.register`, `isDeferred: false`)

- `delegate({ agent, prompt, description?, cwd?, resume? })`
  - `agent`: papel ativo ou `councillor:<seat>`. Nome desconhecido ou desligado → erro
    com a lista válida.
  - `resume`: `sessionId` de uma delegação anterior do mesmo papel (Codex: thread id;
    Claude: não suportado na v1, retorna erro explicativo).
  - Retorno no foreground: mensagem final, `sessionId`, `jobId`, uso (tokens, tempo).
  - Retorno ao passar de `foregroundMinutes`: `{ jobId, status: "background" }`.
- `delegate_result({ jobId })`: estado e, se terminado, resultado do job.
- `delegate_cancel({ jobId })`: encerra o job (mata o processo Codex ou ignora o
  resultado do subagente Claude) e marca `cancelled`. Mudanças parciais ficam no disco.

## Fluxo de uma delegação

1. Resolve papel → config efetiva (motor, modelo, effort, sandbox, prompt).
2. Cria job em `pantheon.jobs` (`running`) e atualiza status line.
3. **Codex**: `$.process.spawn({ argv, cwd, input })` com
   `codex exec --json --skip-git-repo-check -s <sandbox> [-m <model>] [-c …] -`
   (ou `codex exec resume <sessionId> --json … -`). `input` = prompt do papel + prompt da
   tarefa. Eventos da amostra real:
   - `thread.started.thread_id` → `sessionId`
   - `item.started` / `item.completed` com `command_execution` (`command`, `exit_code`),
     `agent_message` (`text`), demais tipos de item → última atividade do job
   - última `agent_message` → resposta final
   - `turn.completed.usage` → tokens
   - saída ≠ 0, `turn.failed`/`error`, ou sem `agent_message` → erro com as últimas
     linhas de stderr
4. **Claude**: `$.agent.spawn({ subagentType: "pantheon:<papel>", prompt, description,
   model })`; resposta pelo `turn.complete` com o mesmo `agentId`.
5. Foreground: a chamada aguarda até `foregroundMinutes`. Termina antes → retorna.
   Passou → retorna `background`; o loop continua desacoplado da chamada e, ao terminar,
   `$.prompt.submit` avisa a sessão ("job X do explorer terminou; use delegate_result").
6. Esc durante foreground: `next.signal` aborta, o loop sai e o processo morre.
7. Reload do mod: jobs em execução morrem com o módulo; o `$.state` mantém a lista, e
   no `session.start` seguinte jobs `running` viram `lost` (retomáveis por `resume`).

Sem retry automático: repetir é decisão do orchestrator.

## Papéis Claude

`oracle`, `designer` e um tipo `councillor` genérico registrados com `$.agent.register`
no `session.start` (`pantheon:oracle`, `pantheon:designer`, `pantheon:councillor`), com
prompt de `hooks/prompts/roles.ts`. Seats Claude do council usam `pantheon:councillor`
com `model` do seat no spawn. Um hook `agent.offer` esconde esses tipos do Agent tool
nativo, para que toda delegação passe por `delegate` e apareça no painel.

## System prompt do orchestrator (`prompt.compose`)

Seção de sessão adicionada por último, função pura da config efetiva (bytes estáveis
enquanto a config não muda, para o prompt cache). Adaptada de `orchestrator.ts`:

- **Mantido**: `<Role>` (gerente de workflow; faz direto só ação isolada, clara e de
  baixo risco); `<Agents>` com os blocos de `role-routing.ts` filtrados pelos papéis
  ativos, sem as linhas "Permissions"/"Stats"; Workflow 1–5 (Understand, Path
  Selection, Delegation Check com routing threshold e dispatch efficiency, Plan and
  Parallelize sem sobrepor escopos de escrita, Verify); Design Handoff Discipline;
  exemplos de delegação em paralelo filtrados por papel ativo.
- **Adaptado**: Background Task Discipline, Active Task Amendments e Session Reuse
  reescritos para `delegate` / `delegate_result` / `delegate_cancel` / `resume`.
  "Lance em background, dê um status curto e encerre o turno" vale para jobs em
  background, com o aviso automático via `$.prompt.submit`. Sem `task_message`/steer.
  Regras de arquivo reescritas para as ferramentas reais.
- **Removido**: Todo Continuity, Marketplace, `wait_for_user`, `question`,
  `<Communication>` (coberto pelo output style e pelo CLAUDE.md do usuário).

Tamanho alvo: ~90 linhas.

## Prompts dos papéis

De `role-prompts.ts`, quase literais, incluindo formatos de saída (`<results>` do
explorer; `<summary>/<changes>/<verification>` do fixer). Regras de arquivo por motor:
Codex (`rg`, shell para diagnóstico, `apply_patch` para edição; read-only proíbe
escrita); Claude (Read/Grep/Glob/Edit). Librarian: "busca na web e MCPs de documentação
disponíveis" no lugar de `context7`/`gh_grep`.

## Council

- Gatilho (`prompt.submit`): regex do `council-inject` mais `conselho`, `consenso`,
  `segunda opinião`; ignora blocos e inline code; mensagens que começam com `/` não
  disparam.
- Com gatilho, anexa ao prompt o bloco Council Mode: (1) buscar contexto externo
  primeiro e embutir resumo, porque conselheiros são read-only; (2) `delegate` em
  paralelo, um por seat (`councillor:<seat>`); (3) uma nova tentativa para resposta
  vazia, seguir sem o seat após 3 minutos, marcar falhas sem omitir; (4) sintetizar.
- Síntese pelo próprio orchestrator, no formato obrigatório de `council.ts`:
  `## Council Response`, `## Per-Councillor Details` (pelo nome do seat),
  `## Council Summary` (Consensus Level unanimous|majority|split, Agreed Points,
  Disagreements, Remaining Uncertainty, Recommended Action).
- Prompt do seat (`prompt`) vai ao fim do prompt de conselheiro.
- Sem gatilho, o custo é uma linha no system prompt citando os seats.

## Painel e comandos

- Status line (`$.ui.status`): `pantheon: N rodando · M em background`; some sem jobs
  ativos.
- `/pantheon`: abre painel (`$.ui.open` + `ui.render` `Pane`). Uma linha por job:
  estado (running, done, error, background, cancelled, lost), papel, motor/modelo, tempo,
  tokens, última atividade (só Codex). Botões Cancelar (ativos) e Copiar resposta
  (`$.ui.copy`, concluídos). Não abre sozinho.
- `/pantheon cancel <jobId>`, `/pantheon config` (config efetiva e origem de cada campo),
  `/pantheon doctor` (`codex` no PATH, versão, `codex login status`, config válida).
- Estado em `$.state` (`pantheon.jobs`), declarado em `types/index.d.ts`.

## Testes

Seguindo o padrão do slim (funções puras testadas por `toContain`/`not.toContain`,
determinismo verificado por igualdade de duas chamadas, regex de gatilho com casos
positivos e negativos), rodando com `claude plugin test` (`claude-code/testing`):

- `config.test.ts`: merge padrão → usuário → projeto; config inválida cai nos padrões;
  `disabledAgents`.
- `roles.test.ts`: teto de sandbox (porta dos casos de `runner/test/offline.js`),
  recusa de `danger-full-access`, resolução de modelo/effort.
- `codex.test.ts`: argv por combinação (sandbox, modelo, effort, `noNetwork`, `resume`);
  parser sobre `docs/superpowers/fixtures/codex-exec-sample.jsonl` e casos de erro.
- `orchestrator.test.ts`: seção reflete papéis ativos; papel desligado some dos blocos e
  dos exemplos de paralelo; mesma config → mesmos bytes; nenhuma menção a `task_revive`,
  `wait_for_user`, `question`, marketplace.
- `council.test.ts`: gatilhos (EN, PT), code fences, inline code, slash command; bloco
  lista todos os seats; formato de síntese presente.
- `jobs.test.ts`: termina no foreground; passa do limite → `background` e
  `prompt.submit` ao terminar; `delegate_cancel` encerra o processo; `session.start`
  marca `running` como `lost`. `$.process.spawn` e relógio mockados.
- `pane.test.ts`: `mount` em `['terminal', 'desktop']`, estados e botão Cancelar.
- Validação manual em sessão real: explorer e fixer com Codex real, background forçado
  com `foregroundMinutes: 0.1`, council com dois seats.

CI: `tsc -p .` e `claude plugin validate .`; `claude plugin test .` se o `claude` rodar
sem login no runner do GitHub, senão fica como passo local obrigatório no CONTRIBUTING
(a confirmar na implementação).

## Riscos e pontos a confirmar na implementação

- Formato completo dos eventos do `codex exec --json` além da amostra (itens de
  `file_change`, `turn.failed`): o parser trata tipos desconhecidos como atividade
  genérica.
- Se o `claude plugin test` consegue mockar `$.process.spawn`; senão `codex.ts` e
  `jobs.ts` recebem um spawn injetável e os testes usam um fake.
- Tempo do hook: a espera em `$.process.spawn`/`$.agent.spawn` não consome o orçamento de
  10 s, mas o processamento de cada evento sim; o parser deve ser leve.
