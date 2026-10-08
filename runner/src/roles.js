// Role settings from JSON: per-agentType harness/model/effort/sandbox overrides
// that sit between a script's per-call options and the .claude/agents frontmatter.
//
//   user     ~/.config/codex-workflows/roles.json
//   project  .codex-workflows/roles.json (walking up from cwd) — wins per field
//
// File shape: { "roles": { "<agentType>": { harness, model, effort, sandbox } } }.
// Every field is optional; unknown keys and invalid values fail the load with the
// file path and the offending field, so a typo never silently widens a sandbox.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse } from "node:path";

export const HARNESSES = new Set(["codex", "claude"]);
// danger-full-access is deliberately absent: a config file can only narrow.
export const ROLE_SANDBOXES = new Set(["read-only", "workspace-write"]);
export const EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
const ROLE_FIELDS = new Set(["harness", "model", "effort", "sandbox"]);

// Sandboxes from most to least restrictive, in both spellings Codex accepts.
const SANDBOX_RANK = {
  "read-only": 0, readOnly: 0,
  "workspace-write": 1, workspaceWrite: 1,
  "danger-full-access": 2, dangerFullAccess: 2,
};

// The more restrictive of two sandboxes; either may be unset.
export function stricterSandbox(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return (SANDBOX_RANK[b] ?? Infinity) < (SANDBOX_RANK[a] ?? Infinity) ? b : a;
}

// The sandbox an agent runs with: the per-call value, else the role's, capped
// by `cap` (--sandbox). Neither a script nor a role file can widen the cap.
export function resolveSandbox({ cap, call, role } = {}) {
  return stricterSandbox(cap, call ?? role);
}
const TOP_LEVEL_FIELDS = new Set(["$schema", "roles"]);

export class RoleConfigError extends Error {
  constructor(path, field, message) {
    super(`${path}: ${field}: ${message}`);
    this.name = "RoleConfigError";
    this.path = path;
    this.field = field;
  }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Check one role's fields (shared by the JSON loader and the frontmatter reader).
// `prefix` names the field in error messages ("roles.scout" or "frontmatter").
export function validateRoleFields(fields, path, prefix, { allowUnknown = false } = {}) {
  for (const k of Object.keys(fields)) {
    if (!ROLE_FIELDS.has(k) && !allowUnknown) {
      throw new RoleConfigError(path, `${prefix}.${k}`, `unknown field (allowed: ${[...ROLE_FIELDS].join(", ")})`);
    }
  }
  const { harness, model, effort, sandbox } = fields;
  if (harness !== undefined && !HARNESSES.has(harness)) {
    throw new RoleConfigError(path, `${prefix}.harness`, `invalid harness ${JSON.stringify(harness)} (expected codex|claude)`);
  }
  if (model !== undefined && (typeof model !== "string" || !model.trim())) {
    throw new RoleConfigError(path, `${prefix}.model`, "expected a non-empty string");
  }
  if (effort !== undefined && !EFFORTS.has(effort)) {
    throw new RoleConfigError(path, `${prefix}.effort`, `invalid effort ${JSON.stringify(effort)} (expected ${[...EFFORTS].join("|")})`);
  }
  if (sandbox !== undefined && !ROLE_SANDBOXES.has(sandbox)) {
    throw new RoleConfigError(path, `${prefix}.sandbox`, `invalid sandbox ${JSON.stringify(sandbox)} (expected read-only|workspace-write)`);
  }
}

// Validate a parsed roles.json; returns { name: { ...fields } }.
export function validateRolesFile(data, path) {
  if (!isPlainObject(data)) throw new RoleConfigError(path, "(root)", "expected a JSON object");
  for (const k of Object.keys(data)) {
    if (!TOP_LEVEL_FIELDS.has(k)) throw new RoleConfigError(path, k, "unknown top-level field (allowed: roles)");
  }
  const roles = data.roles ?? {};
  if (!isPlainObject(roles)) throw new RoleConfigError(path, "roles", "expected an object keyed by role name");
  const out = {};
  for (const [name, fields] of Object.entries(roles)) {
    if (!isPlainObject(fields)) throw new RoleConfigError(path, `roles.${name}`, "expected an object");
    validateRoleFields(fields, path, `roles.${name}`);
    out[name] = { ...fields };
  }
  return out;
}

// Read and validate one roles file; null when it does not exist.
export async function readRolesFile(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return null;
    throw e;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new RoleConfigError(path, "(root)", `invalid JSON: ${e.message}`);
  }
  return validateRolesFile(data, path);
}

export function userRolesPath(home = homedir()) {
  return join(home, ".config", "codex-workflows", "roles.json");
}

async function findProjectRolesFile(cwd) {
  let dir = cwd;
  for (;;) {
    const path = join(dir, ".codex-workflows", "roles.json");
    const roles = await readRolesFile(path);
    if (roles) return { path, roles };
    const parent = parse(dir).dir;
    if (!parent || parent === dir) return null;
    dir = parent;
  }
}

/**
 * The JSON settings for role `name`: user file, then the project file field by
 * field on top. Returns { fields, sources } (sources maps field -> file path), or
 * null when neither file mentions the role. Throws RoleConfigError on a bad file.
 */
export async function loadRoleConfig(name, cwd = process.cwd(), { home = homedir() } = {}) {
  const userPath = userRolesPath(home);
  const user = await readRolesFile(userPath);
  const project = await findProjectRolesFile(cwd);
  const layers = [
    user?.[name] ? { path: userPath, fields: user[name] } : null,
    project?.roles[name] ? { path: project.path, fields: project.roles[name] } : null,
  ].filter(Boolean);
  if (!layers.length) return null;
  const fields = {};
  const sources = {};
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer.fields)) {
      fields[k] = v;
      sources[k] = layer.path;
    }
  }
  return { fields, sources };
}
