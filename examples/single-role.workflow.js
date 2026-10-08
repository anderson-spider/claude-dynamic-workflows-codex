// One agent() on a team role, to measure the latency of a single call.
// The role (scout | librarian | fixer) brings its system prompt, model, effort
// and sandbox (if it sets one) from .claude/agents/<role>.md and roles.json.
//
//   node runner/bin/run-workflow.js examples/single-role.workflow.js \
//     --args '{"role":"scout","prompt":"Where is agentType resolved?"}'

export const meta = {
  name: "single-role",
  description: "One agent() call on a Codex team role (scout, librarian or fixer), for latency measurement",
  phases: [{ title: "Role" }],
};

const ROLES = ["scout", "librarian", "fixer"];
const role = args?.role ?? "scout";
if (!ROLES.includes(role)) throw new Error(`role must be one of ${ROLES.join(", ")} (got '${role}')`);
const prompt = args?.prompt ?? "List the files that define agent roles in this repository, with one line each.";

phase("Role");
const answer = await agent(prompt, { agentType: role, label: role });
log(`${role} → ${String(answer ?? "").slice(0, 200)}`);

return { role, answer };
