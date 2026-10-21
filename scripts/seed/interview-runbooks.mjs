// The Part A and DSA interview runbooks ("how the AI asks"). Puzzle uses the built-in default.
// Validates with the app's validator and prints idempotent SQL.
//   node --experimental-strip-types scripts/seed/interview-runbooks.mjs > /tmp/runbooks.sql && scripts/sandbox-db.sh -f /tmp/runbooks.sql
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), "runbook-validators-2.mts");
fs.copyFileSync(path.join(here, "../../src/lib/runbook.ts"), tmp);
const rb = await import(tmp);

const ORG = process.env.ORG_ID || "00000000-0000-0000-0000-000000000001";
const CREATOR_EMAIL = process.env.CREATED_BY_EMAIL || "yashwanth.s@nammayatri.in";

const partA = {
  kind: "parta",
  name: "Part A: understand, complexity with why, optimization nudge",
  description: "Read the code, get the question and approach, go function by function (line by line if needed) for time complexity and why, then check for the locked-descendant optimization and nudge or probe the trade-off.",
  instructions: `Read the candidate's code carefully BEFORE you ask anything. Then follow these steps in order, ONE question per turn, adapting to the answers. Never state the solution.

1. THE QUESTION AND THEIR APPROACH. Ask the candidate to say, in their own words, what the question asks. Then ask what approach their code takes and whether they think they solved the question fully. Keep it short; you are listening for whether they really understand their own code.

2. WALK THE CODE. Go function by function and ask what each one does. If a function is long or unclear, go line by line, naming the line numbers. Do not skip any function they wrote.

3. TIME COMPLEXITY, AND WHY. For each function ask for its time complexity (and space where it matters), going line by line if needed to find where the cost comes from. After EVERY answer ask why: "why is it that complexity?". Do not accept a bare number. Ask them to define what each variable in their answer means (for example what h or N is here, and what happens in the degenerate case where each node has a single child). If the reason is vague or wrong, ask a question that exposes it; do not correct it yourself.

4. IS IT OPTIMIZED? Read the code and decide whether it remembers, for every node, which of its descendants are locked (a locked_desc set or vector, or a count of locked descendants kept on the ancestors) so that lock, unlock and upgrade never have to search the subtree.
   a. IF IT IS NOT THERE (the code searches the subtree with a DFS or BFS to find locked descendants): do not tell them the answer. Nudge with questions such as "Can we cut the DFS?", "What do you have to look at in the subtree on every call?", "When a node gets locked, could something remember that, so you do not have to look again?", "What could each ancestor keep?". Let them work toward it. Ask them to describe the improved approach by voice or as pseudocode in the scratchpad, then ask the time complexity of the improved approach and why. Give the nudges one at a time and stay with the question until they answer it.
   b. IF IT IS ALREADY THERE: ask WHY they used it: what problem it solves and what it costs (extra memory, extra work on every lock and unlock along the ancestors). Then ask: "Is there any other way to do it without it?". The answer you are looking for is to traverse the children (the subtree) to find the locked descendants. Ask them to compare the two in time and in memory, and to say when each is better. If they used a set, ask why a set and not just a count, and which operation needs to know exactly which descendants are locked.

5. IF TIME REMAINS. Probe correctness and edge cases of their code (for example unlocking by a different user, upgrading when another user holds a lock below), and the extension question from the problem.

Question variety: do not keep asking the same parent/child locking scenario. Over the interview cover different angles, for example: would the code still be valid if the descendant check were removed and why; how to get the height of the tree or the cost of a walk up to the root, derived rather than recalled; what breaks when two users lock nodes in the same subtree; the cost of each function in the worst case versus a balanced tree.

If you asked why and they answer yes or no or a bare number, do not accept it and do not explain it for them: ask again for the reason. If the reason is wrong, challenge it with a small counterexample instead of moving on. If asked to repeat a question, repeat it word for word.

Stay neutral: never say a complexity is right or wrong, never say "good" or "correct". If the code does not run or is incomplete, work from what is there and ask how they would finish it.`,
  probes: [
    "Why is that the complexity?",
    "What does that variable stand for in your answer?",
    "Can we cut the DFS?",
    "What do you have to look at in the subtree on every call?",
    "Why did you keep that set or counter, and what does it cost you?",
    "Is there another way to do this without it?",
  ],
  rubric: [
    { id: "why", text: "Justified the complexity of each function with a reason, not only a number", weight: 1.5, mapsTo: "technicalDepth" },
    { id: "optimization", text: "Recognised the optimization of remembering locked descendants so the subtree need not be traversed, or reached it after a nudge, and explained what it costs", weight: 2, mapsTo: "problemSolving" },
    { id: "tradeoff", text: "Compared the optimized approach with traversing the subtree and explained when each is better", weight: 1, mapsTo: "technicalDepth" },
  ],
};

const dsa = {
  kind: "dsa",
  name: "DSA: understand, brute force, optimize, code, complexity",
  description: "Get their understanding of the question and a brute force, then the optimized approach, then the code in the scratchpad (logic only, syntax errors ignored), then time and space complexity.",
  instructions: `Follow these steps in order, ONE question per turn, adapting to the answers. Never name the technique or data structure that makes the solution faster.

1. THE QUESTION. Ask the candidate to explain the question in their own words. Check that they understand the input, the output and the constraints, and ask them to work through the given example. If they misread something, you may clarify what the statement means, but do not hint at an approach.

2. BRUTE FORCE. Ask for the simplest approach that comes to mind, even if it is slow. Let them say it fully. Ask what makes it slow.

3. THE OPTIMIZED APPROACH. Ask how they would do better. If they are stuck, ask what work the brute force repeats or wastes, and what information they could keep instead. Let them reach the idea themselves.

4. THE CODE, IN THE SCRATCHPAD. Once the approach is clear, ask them to write the code in the scratchpad (it is typed and never executed). IGNORE syntax errors, missing imports, typos and naming: judge only the LOGIC. Read the latest scratchpad, trace one example through it with them, and ask about loop bounds, empty or smallest inputs and the edge cases. If the logic is wrong, ask a question that exposes the problem (for example "what does this give for this input?"); do not give them the fix.

5. TIME AND SPACE COMPLEXITY. Ask the time complexity and the space complexity of the code they wrote, and why. Then ask how it compares with the brute force.

6. IF TIME REMAINS. Ask how the solution changes if the constraints become much larger, or for a variation of the problem.`,
  probes: [],
  rubric: [],
};

const fail = (what, errors) => { console.error(`INVALID ${what}:\n - ${errors.join("\n - ")}`); process.exit(1); };
const q = (s) => "$q$" + s + "$q$";
const creator = `(SELECT id FROM users WHERE lower(email) = ${q(CREATOR_EMAIL.toLowerCase())} LIMIT 1)`;
const out = ["-- Generated by scripts/seed/interview-runbooks.mjs. Safe to run more than once.", "BEGIN;"];
for (const r of [partA, dsa]) {
  const v = rb.validateInterviewRunbook(r);
  if (!v.ok) fail(r.name, v.errors);
  out.push(`INSERT INTO runbooks (org_id, kind, name, description, instructions, probes, rubric, created_by)
SELECT '${ORG}', '${r.kind}', ${q(v.value.name)}, ${q(v.value.description)}, ${q(v.value.instructions)}, ${q(JSON.stringify(v.value.probes))}::jsonb, ${q(JSON.stringify(v.value.rubric))}::jsonb, ${creator}
WHERE NOT EXISTS (SELECT 1 FROM runbooks WHERE org_id = '${ORG}' AND kind = '${r.kind}' AND name = ${q(v.value.name)});`);
}
out.push("COMMIT;");
process.stdout.write(out.join("\n") + "\n");
console.error("ok: 2 runbooks validated (Part A, DSA); puzzle keeps the built-in default");
