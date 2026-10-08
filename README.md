# Pantheon

Mod do Claude Code no estilo do [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim):
a sessão principal do Claude é o orchestrator e delega a especialistas. Os papéis de
busca, pesquisa e implementação rodam no Codex (`codex exec`); os de arquitetura, design e
parte do council rodam como agentes nativos do Claude.

> Projeto da comunidade, sem vínculo com a OpenAI ou a Anthropic.

## Instalação

```text
/plugin install pantheon --marketplace anderson-spider/claude-workflow-codex
```

Requisitos: Claude Code 2.1.295 ou mais novo e o [Codex CLI](https://github.com/openai/codex)
no `PATH`, logado (`codex login`). `/pantheon doctor` confere os dois.

## Papéis

| Papel | Onde roda | Como o orchestrator chama | Padrão |
|---|---|---|---|
| explorer | Codex | `delegate({ agent: "explorer" })` | `gpt-6-luna`, read-only |
| librarian | Codex | `delegate({ agent: "librarian" })` | `gpt-6-luna`, read-only |
| fixer | Codex | `delegate({ agent: "fixer" })` | `gpt-6-luna`, workspace-write |
| oracle | Claude | Agent tool, `pantheon:oracle` | `opus`, Read/Grep/Glob |
| designer | Claude | Agent tool, `pantheon:designer` | modelo da sessão, todas as ferramentas |
| council | os dois | um seat por engine | `alpha` no Codex, `beta` no Claude |

O orchestrator recebe uma seção de system prompt (adaptada do `orchestrator.ts` do slim)
que diz quando delegar, como paralelizar e como chamar cada papel. Papel desligado some
dessa seção e do Agent tool.

### Ferramentas

- `delegate({ agent, prompt, description?, cwd?, model?, effort?, background?, resume? })`:
  roda um papel Codex. Termina no foreground até `foregroundMinutes`; passou disso, volta
  `{ jobId, status: "background" }` e avisa a sessão quando terminar. `resume: <jobId>`
  continua a sessão Codex de um job terminado, no mesmo `cwd`.
- `delegate_result({ jobId })`: estado e resultado de um job.
- `delegate_cancel({ jobId })`: encerra o processo e marca o job `cancelled`; mudanças
  parciais ficam no disco.

### Comandos

- `/pantheon`: painel com os jobs Codex (estado, papel, modelo, tempo, tokens, última
  atividade, se é retomável; botões Cancelar e Copiar resposta) e os agentes nativos
  `pantheon:*`.
- `/pantheon cancel <jobId>`, `/pantheon config` (config efetiva, origem de cada campo e
  erro atual) e `/pantheon doctor`.
- A status line mostra `pantheon: N rodando · M em background` enquanto houver jobs ativos.

## Configuração

`~/.claude/pantheon.json`, sobrescrito por `<repo>/.claude/pantheon.json`. O arquivo só
precisa do que muda; estes são os padrões:

```json
{
  "sandboxCap": "workspace-write",
  "noNetwork": false,
  "foregroundMinutes": 5,
  "disabledAgents": [],
  "agents": {
    "explorer":  { "model": "gpt-6-luna", "sandbox": "read-only" },
    "librarian": { "model": "gpt-6-luna", "sandbox": "read-only" },
    "fixer":     { "model": "gpt-6-luna", "sandbox": "workspace-write" },
    "oracle":    { "model": "opus" },
    "designer":  { "model": "inherit" }
  },
  "council": {
    "seats": {
      "alpha": { "engine": "codex",  "model": "gpt-6-astra", "effort": "high" },
      "beta":  { "engine": "claude", "model": "opus" }
    }
  }
}
```

- Cada papel e seat aceita `model`, `effort` e `prompt` (acrescentado ao fim do prompt do
  papel). Papéis Codex aceitam `sandbox`.
- `disabledAgents` aceita nomes de papel e `"council"`.
- `sandboxCap` e `noNetwork` combinam pelo mais restritivo entre padrão, usuário e
  projeto: um projeto nunca afrouxa a config do usuário. `danger-full-access` é recusado.
- Config inválida: aparece um toast, `delegate` recusa toda delegação até a correção e os
  agentes nativos ficam como na última config válida.
- A config é relida a cada `delegate` e a cada turno; não precisa de reload.

## Council

Peça um council ("run a council", "second opinion", "quero consenso", "segunda opinião",
"conselho") e o orchestrator recebe o Council Mode: despacha todos os seats em background
no mesmo turno, coleta cada resposta quando ela chega e sintetiza em
`## Council Response`, `## Per-Councillor Details` e `## Council Summary`. O gatilho só
vale para mensagens digitadas por você (terminal ou Remote Control), nunca para código
citado, comandos com `/` ou mensagens de SDK.

## Integração com superpowers

Quando uma skill do [superpowers](https://github.com/obra/superpowers) mandar despachar um
subagente, o orchestrator usa os papéis do Pantheon e mantém o processo da skill:

| Despacho da skill | Pantheon |
|---|---|
| implementer (subagent-driven-development) | `delegate` com `fixer`; `pantheon:designer` se for UI |
| task reviewer e re-reviewer | `pantheon:oracle`, um despacho por gate |
| code reviewer final da branch | `pantheon:oracle`, despacho separado |
| agentes em paralelo | vários `delegate`/Agent na mesma mensagem |

`executing-plans` continua no agente principal. O fixer não faz commit (o sandbox do Codex
deixa `.git` somente leitura): o orchestrator commita e gera o pacote de revisão.

## Segurança

- **Workspace**: o `cwd` de um `delegate` precisa resolver (symlinks seguidos) para dentro
  da raiz do repositório da sessão, ou do diretório da sessão fora de um repositório.
  `resume` sempre usa o `cwd` gravado no job.
- **Sandbox**: o efetivo é o mais restritivo entre o papel e o `sandboxCap`; seats do
  council são sempre read-only. Toda execução passa
  `-c sandbox_workspace_write.writable_roots=[]`, para que raízes graváveis extras do seu
  `config.toml` não ampliem a escrita. `/tmp` e `$TMPDIR` continuam graváveis.
- **`--ignore-rules`**: toda execução ignora os arquivos `.rules` do Codex, porque uma
  regra `allow` rodaria comandos fora do sandbox. O custo: regras `forbidden` suas também
  não valem dentro do Pantheon; o sandbox continua valendo.
- **Agentes nativos** seguem a lista de ferramentas e o modo de permissão da sessão; o
  teto de sandbox e o `noNetwork` não se aplicam a eles.

## Desenvolvimento

Veja [CONTRIBUTING.md](CONTRIBUTING.md).

## Créditos

Os prompts do orchestrator, dos papéis e do council são adaptados do
[oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim) (MIT). Este
repositório começou como fork de
[claude-dynamic-workflows-codex](https://github.com/scasella/claude-dynamic-workflows-codex)
(MIT). Licença: [MIT](LICENSE).
