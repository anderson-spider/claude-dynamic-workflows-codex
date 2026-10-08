# Contribuindo

O Pantheon é um mod do Claude Code (plugin de function hooks), sem dependências e sem
build.

## Estrutura

- `hooks/register.tsx`: liga os eventos (`session.start`, `tool.call`, `prompt.compose`,
  `prompt.submit`, `agent.offer`, `command.run`, `ui.render`).
- `hooks/config.ts`: padrões, leitura e merge de `~/.claude/pantheon.json` e
  `<repo>/.claude/pantheon.json`.
- `hooks/roles.ts` e `hooks/workspace.ts`: resolução de papel, sandbox, modelo e `cwd`.
- `hooks/codex.ts`: argv do `codex exec` e parser do JSONL.
- `hooks/jobs.ts`: ciclo de vida dos jobs (foreground, background, cancelamento,
  resume).
- `hooks/pane.tsx`: painel `/pantheon`, status line e relatórios dos subcomandos.
- `hooks/prompts/`: seção do orchestrator, prompts dos papéis, council e superpowers.
- `hooks/types.ts`: contrato compartilhado entre os módulos; `types/index.d.ts`: contrato
  do `$.state`.
- `vendor/claude-code/`: tipos da API de mods da versão em `vendor/claude-code/VERSION`.
- `docs/superpowers/`: spec e plano de implementação.

## Desenvolver

Requer o Claude Code na versão de `vendor/claude-code/VERSION` ou mais nova e o Codex CLI
logado para uso real (os testes não precisam dele).

```bash
claude plugin test .                         # testes (Codex, relógio e fs mockados)
npx -y -p typescript@5.6.3 tsc -p .          # tipos
claude plugin validate .                     # o que o engine recusaria
claude --plugin-dir .                        # sessão com o mod carregado deste checkout
```

O módulo nunca guarda nem repassa o `$`: cada hook monta as closures de que precisa
(`$.noun.event(...)` no ponto da chamada), como o `claude plugin validate` exige.

## Pull requests

- Mantenha os módulos de `hooks/` puros e injetáveis; o que fala com o engine fica em
  `register.tsx`.
- Todo comportamento novo vem com teste em `hooks/*.test.ts`.
- A CI roda tipos, validação e testes; rode os três localmente antes de abrir o PR.
