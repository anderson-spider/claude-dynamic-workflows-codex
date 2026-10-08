// Resolve a workflow `agentType` to its system prompt (and optional model) by
// reading the subagent markdown definition from .claude/agents/<name>.md — the
// same registry the native Agent tool uses. Project scope (walking up from cwd
// for a .claude/agents dir) takes precedence over the user scope (~/.claude).
//
// A definition may also declare the role settings `harness`, `effort` and
// `sandbox` in its frontmatter; roles.json (see roles.js) overrides them, and
// `model`, field by field. A `harness: claude` role is refused by the runner.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse } from "node:path";
import { EFFORTS, loadRoleConfig, validateRoleFields } from "./roles.js";

const cache = new Map();

async function tryRead(path) {
  try {
    return { path, body: await readFile(path, "utf8") };
  } catch {
    return null;
  }
}

async function findUp(startDir, rel) {
  let dir = startDir;
  for (;;) {
    const found = await tryRead(join(dir, rel));
    if (found) return found;
    const parent = parse(dir).dir;
    if (!parent || parent === dir) return null;
    dir = parent;
  }
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) meta[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: text.slice(m[0].length) };
}

// The error thrown when a Claude-harness role reaches the Codex runner.
export function claudeRoleError(name, role) {
  const where = role?.sources?.harness ? ` (harness: claude in ${role.sources.harness})` : " (harness: claude)";
  const err = new Error(
    `agentType '${name}' is a Claude role${where}; the Codex runner does not run it. ` +
      `Call it with Claude Code's native Agent tool (subagent_type: "${name}") instead.`,
  );
  err.code = "CLAUDE_ROLE";
  return err;
}

/**
 * Returns { systemPrompt?, model?, effort?, sandbox?, harness?, source?, sources }
 * or null if neither a definition nor a roles.json entry names the agentType.
 * Settings merge roles.json (project over user) over the frontmatter; `sources`
 * maps each setting to the file it came from. `model` is often a Claude alias
 * like "opus" — pass it through resolveModel() before use.
 * Throws RoleConfigError on an invalid roles.json or frontmatter setting.
 */
export async function loadAgentType(name, cwd = process.cwd(), { home = homedir() } = {}) {
  if (!name) return null;
  const key = `${home}::${cwd}::${name}`;
  if (cache.has(key)) return cache.get(key);

  const rel = join(".claude", "agents", `${name}.md`);
  const found =
    (await findUp(cwd, rel)) ??
    (await tryRead(join(home, ".claude", "agents", `${name}.md`)));
  const json = await loadRoleConfig(name, cwd, { home });

  let result = null;
  if (found || json) {
    result = { sources: {} };
    if (found) {
      const { meta, body } = parseFrontmatter(found.body);
      const fm = {};
      for (const k of ["harness", "model", "effort", "sandbox"]) if (meta[k]) fm[k] = meta[k];
      // A Claude-only effort (e.g. "max" on a native subagent) is not a Codex
      // setting: leave it to Claude Code rather than refuse the definition.
      if (fm.effort && !EFFORTS.has(fm.effort)) delete fm.effort;
      validateRoleFields(fm, found.path, "frontmatter", { allowUnknown: true });
      result.systemPrompt = body.trim();
      result.source = found.path;
      for (const [k, v] of Object.entries(fm)) {
        result[k] = v;
        result.sources[k] = found.path;
      }
    }
    if (json) {
      Object.assign(result, json.fields);
      Object.assign(result.sources, json.sources);
    }
  }
  cache.set(key, result);
  return result;
}
