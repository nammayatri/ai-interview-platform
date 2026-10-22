// Evaluation content from the interviewer PDFs: 1 Part A question, 4 DSA problems, 1 puzzle (+ its interview runbook).
// Validates everything with the app's own validators and prints idempotent SQL (no database access).
//   node --experimental-strip-types scripts/seed/evaluation-content.mjs > /tmp/seed.sql
//   scripts/sandbox-db.sh -f /tmp/seed.sql
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), "runbook-validators.mts");
fs.copyFileSync(path.join(here, "../../src/lib/runbook.ts"), tmp);
const rb = await import(tmp);

const ORG = process.env.ORG_ID || "00000000-0000-0000-0000-000000000001";
const CREATOR_EMAIL = process.env.CREATED_BY_EMAIL || "yashwanth.s@nammayatri.in";

const track = (name, approach, timeComplexity, spaceComplexity, probes = []) => ({ name, approach, timeComplexity, spaceComplexity, probes });
const hint = (order, text, extra = {}, scoreDiscount = 0.1) => ({ order, text, scoreDiscount, ...extra });
const crit = (id, text, weight, mapsTo) => ({ id, text, weight, mapsTo });
const noOutcome = { passed: [], partial: [], failed: [] };

// ─── Part A: Tree locking ────────────────────────────────────────────────────
const treeLocking = {
  title: "Tree Locking: lock and unlock on a huge m-ary tree",
  kind: "parta",
  difficulty: "hard",
  tags: ["tree", "design", "systems"],
  runbook: {
    statementMd: `The world map is represented as an **m-ary tree** (a node has up to \`m\` children). The number of nodes **N is very large**.

\`\`\`
World
├── Asia
│   ├── India          <- x
│   │   ├── Karnataka
│   │   │   └── Bangalore
│   │   │       ├── J.P. Nagar
│   │   │       └── HSR
│   │   └── Tamil Nadu
│   └── China
└── Africa
\`\`\`

Define two operations, \`lock(x)\` and \`unlock(x)\`, where \`x\` is a pointer to a node in the tree.

- \`lock(x)\` takes **exclusive access to the subtree rooted at x**.
- \`unlock(x)\` reverts what \`lock\` does. It can only be called on a node on which \`lock\` was already called.

Once \`lock(x)\` succeeds:

- any \`lock(A)\` where \`A\` is an **ancestor** of \`x\` must fail, and
- any \`lock(B)\` where \`B\` is **inside the subtree of x** must fail.

Find a **time-optimal** solution.`,
    solutionTracks: [
      track(
        "O(N), flag only on the locked node",
        "Keep an isLocked flag in the node and set it only on the locked node. To lock x: check that no ancestor is locked (a DFS from the root, or by walking up if there is a parent pointer) and check that no node in x's subtree is locked with a DFS.",
        "O(N) per operation (O(h) for the ancestor check if there is a parent pointer, but the descendant check is still a DFS)",
        "O(1) extra per node",
        [
          "What does the descendant check cost, and why?",
          "Is the cost of this solution m times h, or m to the power h? Which one is the number of nodes?",
          "You have a pointer to x. Do you need to start from the root?",
        ]
      ),
      track(
        "O(N), flags on all ancestors and all descendants",
        "On lock(x), set a flag on x, on every ancestor and on every descendant, so that the check at lock time is O(1). Unlock clears them again.",
        "check O(1), but lock and unlock must touch the whole subtree: O(N)",
        "O(1) extra per node",
        ["Where did the work move to? What does lock cost now?", "Why is the number of nodes in the subtree large here?"]
      ),
      track(
        "Check x against the path of every locked node",
        "Keep the list of locked nodes. Lock x only if x is not on the path from any locked node to the root, plus the check that no ancestor of x is locked. Much better than O(N) but not optimal.",
        "O(log N times number of locked nodes), where log is to the base m",
        "O(number of locked nodes)",
        ["What happens to the cost when many nodes are already locked?", "Is there a way to get O(log N) no matter how many nodes are locked?"]
      ),
      track(
        "Parent pointer + isLocked + lockedDescendantsCount (the best)",
        "Add a parent pointer and, per node, isLocked and an integer lockedDescendantsCount. lock(x): fail if x.lockedDescendantsCount > 0; walk up from x to the root and fail if x or any ancestor isLocked; then walk up again incrementing lockedDescendantsCount on every ancestor; set x.isLocked. unlock(x): require x.isLocked, clear it and walk up decrementing the counts. Variants that are acceptable: a boolean isDescendantLocked (but unlock must then check all m children of every ancestor, so unlock costs m times log N), or a set/array of lockedPaths flags.",
        "O(h) = O(log N to the base m) for lock and unlock",
        "O(1) extra per node (one counter, one flag, one pointer)",
        [
          "Why must lock(B) fail when B is inside a locked subtree, and how does your structure make it fail without a traversal?",
          "Why is a flag per level wrong? (Many nodes on one level are completely independent.)",
          "What is the difference between isLocked and the descendants counter? Can you use them interchangeably?",
          "What is the time complexity of lock and of unlock, in terms of the height of the tree? What if m is 1?",
        ]
      ),
    ],
    outcomeProbes: {
      passed: [
        "Walk me through lock on the tree in the diagram: lock Karnataka, then try Bangalore, then India.",
        "What is the time complexity of every function you wrote, one at a time?",
        "Extension: how would you implement upgradeLock(x, y), where x is locked, y is an ancestor of x and no other descendant of y is locked, moving the lock from x to y? And downgradeLock(x, y), where y is a descendant of x?",
      ],
      partial: [
        "Which sequence of lock and unlock calls do you think your code gets wrong, and why?",
        "Do you ever mix up isLocked and the descendants counter in a check?",
      ],
      failed: [
        "Tell me what each function is meant to do. What stops it from running or from giving the right answer?",
        "How would you finish the missing part, in pseudocode or just the approach?",
      ],
    },
    hintLadder: [
      hint(1, "You have a pointer to x. Why should it take O(N) to trace the path up to the root? Can you change the structure of the node?", { notBeforeMin: 6 }, 0.1),
      hint(2, "What could each node remember about what is happening below it, so that you do not have to look into its subtree?", { afterWeakAnswers: 2 }, 0.15),
      hint(3, "If many nodes are already locked, does checking the path of each locked node still scale? Is there a way to get log N whatever the number of locked nodes?", { notBeforeMin: 12, afterWeakAnswers: 3 }, 0.2),
    ],
    rubric: [
      crit("understanding", "Grasped the problem quickly, including why lock(B) must fail for a node inside a locked subtree (without being told)", 2, "problemSolving"),
      crit("intuition", "Right intuition: ancestors need an upward check and descendants need per-node bookkeeping, not a flag per level and not a full-tree scan", 2, "problemSolving"),
      crit("complexity", "Stated the complexity of each function correctly in terms of tree height (log N to the base m), not m times h and not N, and understood that a tree grows exponentially", 2, "technicalDepth"),
      crit("structure", "Familiarity with the data structure: parent pointer, isLocked plus lockedDescendantsCount, and unlock exactly reversing lock; does not mix up the two flags", 1.5, "technicalDepth"),
      crit("code", "Code is neat and well organised and handles the cases (already locked, unlock only a locked node)", 1, "technicalDepth"),
      crit("communication", "Explained their thinking clearly and used the hints well", 1, "communication"),
      crit("ownership", "Did not give up, accepted correction and did not insist on wrong things; put in the effort to finish the problem", 1, "cultureFit"),
    ],
    defaults: { budgetMin: 20, graceMin: 3, earlyDoneAfterMin: 10 },
  },
};

// ─── DSA problems ────────────────────────────────────────────────────────────
const kthObstacle = {
  title: "Kth Nearest Obstacle Queries",
  kind: "dsa",
  difficulty: "medium",
  tags: ["heap", "priority queue"],
  runbook: {
    statementMd: `There is an infinite 2D plane.

You are given a positive integer \`k\`. You are also given a 2D array \`queries\` with the following queries:

- \`queries[i] = [x, y]\`: build an obstacle at coordinate \`(x, y)\`. It is guaranteed that there is no obstacle at this coordinate when the query is made.

After each query, find the distance of the **k-th nearest obstacle** from the origin.

Return an integer array \`results\` where \`results[i]\` is the k-th nearest obstacle after query \`i\`, or \`-1\` if there are fewer than \`k\` obstacles.

Initially there are no obstacles. The distance of an obstacle at \`(x, y)\` from the origin is \`|x| + |y|\`.

**Example 1**

\`\`\`
Input:  queries = [[1,2],[3,4],[2,3],[-3,0]], k = 2
Output: [-1,7,5,3]
\`\`\`

- After queries[0]: fewer than 2 obstacles.
- After queries[1]: obstacles at distances 3 and 7.
- After queries[2]: obstacles at distances 3, 5 and 7.
- After queries[3]: obstacles at distances 3, 3, 5 and 7.

**Example 2**

\`\`\`
Input:  queries = [[5,5],[4,4],[3,3]], k = 1
Output: [10,8,6]
\`\`\`

**Constraints**

- 1 <= queries.length <= 2 * 10^5
- All queries[i] are unique.
- -10^9 <= queries[i][0], queries[i][1] <= 10^9
- 1 <= k <= 10^5`,
    solutionTracks: [
      track("Sort after every query", "Append the new distance to a list, sort the list and read element k-1 (or -1 if there are fewer than k).", "O(Q^2 log Q)", "O(Q)", ["What do you pay on every query, and how many queries are there?"]),
      track("Sorted list with binary-search insertion", "Keep the distances sorted: find the position with binary search and insert. The k-th element is read directly.", "O(Q^2) because inserting into an array shifts elements (the search itself is O(log Q))", "O(Q)", ["Binary search is O(log Q), so why is the total still quadratic?"]),
      track(
        "Max-heap of size k (the best)",
        "Only the k nearest distances matter. Keep a max-heap of at most k distances (in a language with a min-heap, push the negated distance). Push the new distance; if the heap holds more than k, pop the largest. If the heap has fewer than k elements answer -1, otherwise the answer is the largest element still in the heap, i.e. its top. Note: the draft pseudocode in the source document pops a min-heap and returns the popped value; that is not correct (on example 1 it would answer 3 instead of 7 after the second query).",
        "O(Q log k)",
        "O(k)",
        ["Why a max-heap and not a min-heap?", "What goes wrong if you store every distance in the heap?", "How do you get a max-heap in your language?"]
      ),
    ],
    outcomeProbes: noOutcome,
    hintLadder: [
      hint(1, "Do you need all the distances in order, or only some of them?", { notBeforeMin: 5 }, 0.1),
      hint(2, "Which element do you need to be able to remove quickly when a closer obstacle arrives?", { afterWeakAnswers: 2 }, 0.15),
    ],
    rubric: [
      crit("understanding", "Understood the problem: Manhattan distance, k-th nearest after every query, -1 when fewer than k", 1, "problemSolving"),
      crit("brute", "Gave a correct brute force and its complexity", 1, "technicalDepth"),
      crit("insight", "Saw that only the k nearest distances matter and that a max-heap of size k gives the k-th nearest at its top", 2, "problemSolving"),
      crit("complexity", "Stated O(Q log k) time and O(k) space and explained why", 2, "technicalDepth"),
      crit("code", "Code in the scratchpad is correct, including the -1 case and the max-heap trick for a min-heap language", 1.5, "technicalDepth"),
      crit("communication", "Explained the approach clearly and walked an example through it", 1, "communication"),
    ],
    defaults: { budgetMin: 20, graceMin: 3, earlyDoneAfterMin: 10 },
  },
};

const goodSubarrays = {
  title: "Count the Number of Good Subarrays",
  kind: "dsa",
  difficulty: "medium",
  tags: ["sliding window", "hash map"],
  runbook: {
    statementMd: `Given an integer array \`nums\` and an integer \`k\`, return the number of **good** subarrays of \`nums\`.

A subarray \`arr\` is **good** if there are **at least \`k\` pairs** of indices \`(i, j)\` such that \`i < j\` and \`arr[i] == arr[j]\`.

A subarray is a contiguous non-empty sequence of elements within an array.

**Example 1**

\`\`\`
Input:  nums = [1,1,1,1,1], k = 10
Output: 1
\`\`\`

The only good subarray is the array \`nums\` itself.

**Example 2**

\`\`\`
Input:  nums = [3,1,4,3,2,2,4], k = 2
Output: 4
\`\`\`

There are 4 good subarrays:

- \`[3,1,4,3,2,2]\` has 2 pairs.
- \`[3,1,4,3,2,2,4]\` has 3 pairs.
- \`[1,4,3,2,2,4]\` has 2 pairs.
- \`[4,3,2,2,4]\` has 2 pairs.

**Constraints**

- 1 <= nums.length <= 10^5
- 1 <= nums[i], k <= 10^9`,
    solutionTracks: [
      track("Every subarray, count the pairs", "For every subarray, count the equal pairs with a frequency map (or directly with two loops) and count it if the pairs are at least k.", "O(n^3) with two loops per subarray, O(n^2) if the pair count is extended incrementally with a frequency map", "O(n)", ["How many subarrays are there, and what does each check cost?", "How can the pair count of [l..r+1] reuse the count of [l..r]?"]),
      track(
        "Sliding window with a frequency map (the best)",
        "Adding an element x to a window increases the pair count by freq[x] (then freq[x]++). Removing an element x decreases it by freq[x]-1, i.e. freq[x]-- first and then subtract the new freq[x]. If the window [l..r] is good, every window [l..r'] with r' >= r is good too, so for each left end find the smallest right end with a two-pointer sweep and add n - r to the answer; then move the left end forward. Use 64-bit integers: the pair count can reach about n^2/2.",
        "O(n)",
        "O(n)",
        ["If a window is already good, what can you say about every window that extends it to the right?", "How does the pair count change when you add or remove one element?", "Can the pair count overflow a 32-bit integer?"]
      ),
    ],
    outcomeProbes: noOutcome,
    hintLadder: [
      hint(1, "If a window is already good, what can you say about every window that extends it to the right?", { notBeforeMin: 5 }, 0.1),
      hint(2, "How does the number of pairs change when you add or remove one element from the window?", { afterWeakAnswers: 2 }, 0.15),
    ],
    rubric: [
      crit("understanding", "Understood what a good subarray is and counted pairs correctly on the examples", 1, "problemSolving"),
      crit("brute", "Gave a correct brute force and its complexity", 1, "technicalDepth"),
      crit("insight", "Saw the monotonic property (a good window stays good when extended) and the O(1) update of the pair count with a frequency map", 2, "problemSolving"),
      crit("complexity", "Stated O(n) time and O(n) space and justified that each pointer moves once", 2, "technicalDepth"),
      crit("code", "Code in the scratchpad is correct, with the right order of update and 64-bit pair count", 1.5, "technicalDepth"),
      crit("communication", "Explained the approach clearly and walked an example through it", 1, "communication"),
    ],
    defaults: { budgetMin: 20, graceMin: 3, earlyDoneAfterMin: 10 },
  },
};

const koko = {
  title: "Koko Eating Bananas",
  kind: "dsa",
  difficulty: "medium",
  tags: ["binary search"],
  runbook: {
    statementMd: `Koko loves to eat bananas. There are \`n\` piles of bananas, the \`i\`-th pile has \`piles[i]\` bananas. The guards have gone and will come back in \`h\` hours.

Koko can decide her bananas-per-hour eating speed \`k\`. Each hour, she chooses some pile of bananas and eats \`k\` bananas from that pile. If the pile has fewer than \`k\` bananas, she eats all of them instead and will not eat any more bananas during this hour.

Koko likes to eat slowly but still wants to finish eating all the bananas before the guards return.

Return the **minimum integer \`k\`** such that she can eat all the bananas within \`h\` hours.

**Example 1**

\`\`\`
Input:  piles = [3,6,7,11], h = 8
Output: 4
\`\`\`

**Example 2**

\`\`\`
Input:  piles = [30,11,23,4,20], h = 5
Output: 30
\`\`\`

**Example 3**

\`\`\`
Input:  piles = [30,11,23,4,20], h = 6
Output: 23
\`\`\`

**Constraints**

- 1 <= piles.length <= 10^4
- piles.length <= h <= 10^9
- 1 <= piles[i] <= 10^9`,
    solutionTracks: [
      track("Try every speed", "Try k = 1, 2, 3, ... and compute the hours needed, sum of ceil(pile / k), until it is at most h.", "O(n times max(piles))", "O(1)", ["What is the largest speed you could ever need?", "How big can max(piles) be here?"]),
      track(
        "Binary search on the speed (the best)",
        "If speed k is fast enough then k+1 is too, so the feasibility is monotonic. Binary search k in [1, max(piles)] (a tighter lower bound is ceil(sum / h)); for each candidate compute hours = sum of ceil(pile / k) with integer arithmetic. The speed max(piles) always works because h >= n. The sum of hours can reach 10^13, so use 64-bit integers.",
        "O(n log(max(piles)))",
        "O(1)",
        ["If a speed k is fast enough, what about k+1?", "How do you compute ceil(p / k) with integers?", "Can the total hours overflow a 32-bit integer?"]
      ),
    ],
    outcomeProbes: noOutcome,
    hintLadder: [
      hint(1, "If a speed k is fast enough, what can you say about k + 1?", { notBeforeMin: 5 }, 0.1),
      hint(2, "Is there a way to search over the answer instead of trying every speed?", { afterWeakAnswers: 2 }, 0.15),
    ],
    rubric: [
      crit("understanding", "Understood the problem, including that each hour only one pile is touched and ceil(pile / k) hours per pile", 1, "problemSolving"),
      crit("brute", "Gave a correct brute force over the speed and its complexity", 1, "technicalDepth"),
      crit("insight", "Saw the monotonic feasibility and binary searched the answer with the right bounds", 2, "problemSolving"),
      crit("complexity", "Stated O(n log max(piles)) time and O(1) space", 2, "technicalDepth"),
      crit("code", "Code in the scratchpad is correct: the ceiling division, the loop boundaries and the 64-bit total", 1.5, "technicalDepth"),
      crit("communication", "Explained the approach clearly and walked an example through it", 1, "communication"),
    ],
    defaults: { budgetMin: 20, graceMin: 3, earlyDoneAfterMin: 10 },
  },
};

const trie = {
  title: "Implement Trie (Prefix Tree)",
  kind: "dsa",
  difficulty: "medium",
  tags: ["trie", "design"],
  runbook: {
    statementMd: `A **trie** (pronounced "try") or **prefix tree** is a tree data structure used to efficiently store and retrieve keys in a dataset of strings. There are various applications of this data structure, such as autocomplete and spellchecker.

Implement the \`Trie\` class:

- \`Trie()\` initializes the trie object.
- \`void insert(String word)\` inserts the string \`word\` into the trie.
- \`boolean search(String word)\` returns \`true\` if the string \`word\` is in the trie (it was inserted before), and \`false\` otherwise.
- \`boolean startsWith(String prefix)\` returns \`true\` if there is a previously inserted string \`word\` that has the prefix \`prefix\`, and \`false\` otherwise.

**Example**

\`\`\`
Input
["Trie", "insert", "search", "search", "startsWith", "insert", "search"]
[[], ["apple"], ["apple"], ["app"], ["app"], ["app"], ["app"]]

Output
[null, null, true, false, true, null, true]
\`\`\`

\`\`\`
Trie trie = new Trie();
trie.insert("apple");
trie.search("apple");   // true
trie.search("app");     // false
trie.startsWith("app"); // true
trie.insert("app");
trie.search("app");     // true
\`\`\`

**Constraints**

- 1 <= word.length, prefix.length <= 2000
- word and prefix consist only of lowercase English letters.
- At most 3 * 10^4 calls in total will be made to insert, search and startsWith.`,
    solutionTracks: [
      track("Keep the words in a list or set", "Store inserted words in a hash set. search is a lookup; startsWith scans every stored word and checks the prefix.", "insert O(L), search O(L), startsWith O(W times L) for W stored words", "O(total characters)", ["What does startsWith cost as more words are inserted?"]),
      track("Hash set of all prefixes", "On insert, add every prefix of the word to a prefix set and the word itself to a word set. Both lookups become O(L), but each insert stores L prefixes of up to L characters.", "insert O(L^2), search O(L), startsWith O(L)", "O(L^2) per inserted word in the worst case", ["What does insert cost now, and what does it do to memory?", "What do 'app' and 'apple' have in common? Are you storing it twice?"]),
      track(
        "Trie nodes (the best)",
        "Each node has children (an array of 26 or a hash map keyed by character) and an end-of-word flag. insert walks and creates nodes; search walks and requires the end flag on the last node; startsWith walks and only requires that the path exists.",
        "insert, search and startsWith are all O(L)",
        "O(total characters stored) with maps, up to 26 times that with arrays",
        ["What does a node need to remember to tell a word from a mere prefix?", "Array of 26 or a hash map for the children: what is the trade-off?", "Why is search for 'app' false after inserting only 'apple'?"]
      ),
    ],
    outcomeProbes: noOutcome,
    hintLadder: [
      hint(1, "What do \"app\" and \"apple\" have in common? Can you avoid storing that part twice?", { notBeforeMin: 5 }, 0.1),
      hint(2, "What would a node need to remember to tell you that a word ends here, and not only that it is a prefix?", { afterWeakAnswers: 2 }, 0.15),
    ],
    rubric: [
      crit("understanding", "Understood the difference between search and startsWith and the example", 1, "problemSolving"),
      crit("brute", "Gave a simple correct approach (set or list) and its costs", 1, "technicalDepth"),
      crit("insight", "Arrived at the prefix tree: shared prefixes stored once, with an end-of-word marker", 2, "problemSolving"),
      crit("complexity", "Stated O(L) for each operation and the space trade-off between an array and a hash map for children", 2, "technicalDepth"),
      crit("code", "Code in the scratchpad is correct for all three methods, including the end flag", 1.5, "technicalDepth"),
      crit("communication", "Explained the structure clearly and traced the example through it", 1, "communication"),
    ],
    defaults: { budgetMin: 20, graceMin: 3, earlyDoneAfterMin: 10 },
  },
};

// ─── Puzzle: Poisoned Wine ───────────────────────────────────────────────────
const poisonedWine = {
  title: "Poisoned Wine",
  difficulty: "hard",
  tags: ["counting argument", "group testing"],
  runbook: {
    statementMd: `A king has **1,000 bottles of wine**. Some of them are poisoned. Poisoned wine looks and tastes normal. Anyone who drinks even a drop of poisoned wine dies after a fixed delay; anyone who drinks only clean wine is fine.

A tester can take a sip from as many bottles as you like, and you may mix sips from several bottles into one cup. The goal is always to use **as few testers as possible** while being **certain** of the answer.

**Stage 1: one poisoned bottle, one round.** Exactly one bottle is poisoned. The poison kills in 24 hours, and the party starts in 24 hours. Everyone drinks at the same time, you wait 24 hours and look at who is dead. You cannot give anyone a second drink based on the results.

What is the minimum number of testers needed to identify the poisoned bottle? How do you assign bottles to testers?`,
    acceptedAnswers: [
      "STAGE 1 (one poisoned bottle, one round): 10 testers. Number the bottles 0 to 999 in binary (10 digits); tester j sips from every bottle whose j-th binary digit is 1; the dead testers spell the poisoned bottle's number in binary. 9 testers are not enough: each tester has 2 outcomes, 2^9 = 512 < 1000 (the counting argument is the core idea of the whole puzzle).",
      "STAGE 1B (small case, 8 bottles numbered 0 to 7, one poisoned, one round of 24 hours, 3 testers A, B, C): write each bottle number in binary with 3 digits, A is the 4s digit, B the 2s digit, C the 1s digit, and a tester drinks the bottle when their digit is 1. Bottle 0 = 0 0 0 (nobody drinks it), 1 = 0 0 1 (C), 2 = 0 1 0 (B), 3 = 0 1 1 (B, C), 4 = 1 0 0 (A), 5 = 1 0 1 (A, C), 6 = 1 1 0 (A, B), 7 = 1 1 1 (A, B, C). So A drinks 4, 5, 6, 7; B drinks 2, 3, 6, 7; C drinks 1, 3, 5, 7. Decoding: dead testers spell the bottle in binary (only A and C dead = 1 0 1 = bottle 5; nobody dead = bottle 0; all dead = bottle 7). Any assignment that gives all 8 bottles different patterns is acceptable; 3 testers are enough because 2^3 = 8 and 2 are not (2^2 = 4 < 8). It scales to 1,000 bottles with 10 testers.",
      "STAGE 2 (one poisoned bottle, two rounds of 24 hours): 7 testers. Each tester has 3 outcomes (dies after round 1, dies after round 2, survives), so 3^n >= 1000 gives n = 7 (3^6 = 729, 3^7 = 2187). Write each bottle in base 3 with 7 digits: digit 0 = the tester never drinks it, digit 1 = drinks it in round 1, digit 2 = drinks it in round 2. A tester who dies in round 1 cannot drink their round-2 bottles, but that does not matter: their digit for the poisoned bottle is 1, so none of their digit-2 bottles can be poisoned. In general with r rounds: (r + 1)^n >= N. Choosing round-2 drinks based on round-1 results cannot beat this because the number of outcomes per tester is still r + 1.",
      "BONUS (poison kills in exactly 20 hours, 24 hour deadline, the exact hour of death is visible): 4 testers. A tester can drink at hour 0, 1, 2, 3 or 4, which gives 5 possible death times plus survival = 6 outcomes. 6^3 = 216 < 1000, 6^4 = 1296 >= 1000. Digit 0 = never drink, digit k = drink at hour k - 1. This checks that the candidate understood that outcomes per tester is what matters, not the word 'rounds'.",
      "STAGE 3 (exactly two poisoned bottles, one round): the dead set is the OR of the two bottles' codes, so binary breaks: with 3-bit codes, bottles 3 (011) and 4 (100) give 111, and so do bottles 5 (101) and 2 (010). Lower bound: there are 1000 * 999 / 2 = 499,500 pairs and each tester has 2 outcomes, so 2^n >= 499,500 needs n >= 19 (2^18 = 262,144, 2^19 = 524,288). A natural partial idea is 20 testers (two per bit: one drinks the bottles with the bit 1, one with the bit 0): it shows where the two bottles agree and disagree but only identifies the pair if they differ in one bit. A complete plan with 96 testers: arrange the bottles on a 32 x 32 grid (row = b div 32, column = b mod 32, diagonal = (row + column) mod 32) with one tester per row, per column and per diagonal; each bottle is sipped by exactly three testers and a bottle is poisoned if and only if all three of its testers died. Two different bottles share at most one of {row, column, diagonal}, so a clean bottle shares at most one tester with each poisoned bottle and at most two of its three testers can die. Rows and columns alone (64 testers) fail because of the rectangle-corner ambiguity; the diagonals break the tie. The true minimum lies between 19 and 96 and the interview does not need it: this stage is about reasoning, not a magic number.",
      "GRADING (grade on the furthest stage reached and how much help was needed; say both in the feedback, for example 'Stage 2 solved, 1 hint; Stage 3 reached the lower bound, no complete plan'). BELOW BAR: could not reach 10 in Stage 1 even with all hints, or reached 10 but could not explain why fewer fails. MEETS BAR (hire): Stage 1 solved with a clear reason and Stage 2 solved with at most 1 to 2 hints; finishing the bonus round counts as a hire as well, with up to 4 hints. Only the reasoning is graded here, not communication or culture fit. STRONG: Stages 1 and 2 with little help, explains the round-1 death subtlety, gets the bonus quickly, and in Stage 3 finds why binary breaks and gives the lower bound of 19. EXCEPTIONAL: all of that plus a complete Stage 3 plan (grid with diagonals or equivalent) with a correct argument for why it works. Signals worth more than the final number: a counting argument without being prompted, testing their own plan on a small example before claiming it works, finding a counterexample to their own idea, staying calm and structured when there is no neat answer.",
      "FOLLOW-UP KNOWLEDGE: with three poisoned bottles a clean bottle could have its three testers killed by three different poisoned bottles, so a fourth direction (another diagonal slope) is needed, and a prime-sized grid such as 37 x 37 guarantees that any two bottles still share at most one tester. With a second round the 20-tester bit-pair plan can be run first and the remaining ambiguity resolved in round 2.",
    ],
    expectedMin: 30,
    // Hints are held back: nothing before minute 8, and each one is conceptual (it asks how many states a tester can be
    // in, it never names the structure or the numbers). Time windows follow the guide's plan: Stage 1 about 0 to 10 min,
    // the 8-bottle case about 3, Stage 2 from about 13, the bonus from about 28, Stage 3 from about 33.
    // "expiresAfterMin" skips an unused hint so a strong candidate can still reach the later ones.
    hintLadder: [
      hint(1, "What does each tester's result tell you at the end of the experiment?", { notBeforeMin: 8, expiresAfterMin: 20 }, 0.05),
      hint(2, "How many different states can a single tester end up in?", { notBeforeMin: 11, afterWeakAnswers: 1, expiresAfterMin: 20 }, 0.05),
      hint(3, "If each tester can end up in some number of states, how many different overall results can several testers produce together?", { notBeforeMin: 14, afterWeakAnswers: 1, expiresAfterMin: 22 }, 0.05),
      hint(4, "Think about what can happen to one tester over the whole time you have now. How many states can you form?", { notBeforeMin: 18, expiresAfterMin: 32 }, 0.05),
      hint(5, "How many states can you form now? What does that number of states suggest for how you write the bottle numbers?", { notBeforeMin: 22, expiresAfterMin: 34 }, 0.05),
      hint(6, "Think about everything that can happen to one tester now. How many states can you form?", { notBeforeMin: 29, expiresAfterMin: 36 }, 0.05),
      hint(7, "Can you write down two different pairs of bottles that would give exactly the same set of dead testers?", { notBeforeMin: 34 }, 0.06),
      hint(8, "How many different pairs are there, and what does that tell you about the least number of testers you could ever need?", { notBeforeMin: 37 }, 0.06),
      hint(9, "Think about laying the bottles out in some regular shape. What could one tester per line of that shape tell you?", { notBeforeMin: 40, afterWeakAnswers: 1 }, 0.06),
      hint(10, "Your lines leave some ties. Is there another set of lines you could add that breaks them?", { notBeforeMin: 43, afterWeakAnswers: 1 }, 0.06),
    ],
    rubric: [
      crit("stage1", "Stage 1: reached 10 testers with a clear binary assignment and explained why 9 is not enough", 2, "problemSolving"),
      crit("small_case", "Small case: built the correct 8-bottle, 3-tester assignment (every bottle a different pattern, bottle 0 drunk by nobody) and decoded a result from it", 1, "problemSolving"),
      crit("counting", "Used the counting argument (number of outcomes versus number of possibilities) without being prompted", 2, "problemSolving"),
      crit("stage2", "Stage 2: reached 7 testers with base 3 and handled the subtlety of a tester dying in round 1", 2, "problemSolving"),
      crit("bonus", "Bonus: reached 4 testers by counting the outcomes per tester (6), not the rounds", 1, "problemSolving"),
      crit("stage3_break", "Stage 3 (stretch): found why the binary plan breaks (two pairs with the same dead set) and gave the lower bound of 19", 1.5, "problemSolving"),
      crit("stage3_plan", "Stage 3 (stretch): found a complete plan (a grid with diagonals or equivalent) with a correct argument for why no clean bottle looks poisoned", 1, "problemSolving"),
      crit("self_check", "Tested their own plan on a small example and found counterexamples to their own idea instead of waiting to be told", 0.5, "problemSolving"),
      // Only problem solving is scored for this puzzle (no communication or culture-fit criteria), so those two are
      // reported as "not assessed" in a puzzle-only interview. The weights are chosen so that finishing the bonus
      // round (8 of 11 = 0.73 credit, 3.9 of 5) is a hire with up to 4 hints, and a strong hire needs Stage 3 too.
    ],
  },
};

// The staged way to run this puzzle, as an interview runbook the interviewer can plug into the puzzle stage.
const poisonedWineFlow = {
  kind: "puzzle",
  name: "Poisoned Wine: staged interview",
  description: "Runs the puzzle one stage at a time (one bottle one round, two rounds, exact timing, two bottles) with the guide's follow-ups and wrong-answer responses. Plug this into the Puzzle stage with the Poisoned Wine puzzle.",
  instructions: `DO NOT GIVE THE ANSWER AWAY. The candidate must find every idea themselves. You never introduce, hint at or fill in: the number of states or outcomes a tester has, the words binary, base 3 or base 6, hour values for drinking, rows, columns, diagonals or any grid or its size, bit patterns, 2^n or 3^n or 6^n, or the numbers 4, 7, 10, 19 or 96. You do not confirm that an answer is right (no "exactly", "right", "correct"); acknowledge neutrally and move on, and if a number looks wrong ask them to check how they got it. Only react to what the candidate proposes. When they ask for a hint, give one ONLY when the UNLOCKED HINT section exists, as written, with nothing added; otherwise ask what they have tried. Do not rescue them with a chain of small leading questions; one open question at a time ("Walk me through it.", "Why?"), then wait.

Run this puzzle as separate STAGES. Present ONE stage at a time. Never mention a later stage before you reach it, and never state the answer to a stage unless the candidate is stuck and time is short. The candidate only sees Stage 1 on screen; you say the later stages out loud. The candidate should reason out loud; stop at whichever stage they top out on.
Time plan: Stage 1 in about 5 to 10 minutes, the small 8-bottle case in about 3, Stage 2 in 10 to 15, the bonus in 5, then Stage 3 with whatever time remains. Most candidates will not finish Stage 3 and that is expected.

STAGE 1 (the statement on screen). Say: "1,000 bottles, one is poisoned, the poison kills in 24 hours and the party is in 24 hours. What is the fewest people you need to taste to find it?" Clarifications you may give if asked: one person can sip from many bottles, drinks can be mixed, there is no second round. After they answer, ask: "Can you prove that one fewer tester is not enough?" (you want the counting argument), "Does anyone drink from bottle 0? Is that a problem?", "Would 10 testers work for 1,024 bottles? For 1,025?"
Common wrong answers: "500 testers, 2 bottles each" (ask what a tester's result tells them and whether one tester could cover many bottles); "binary search, about 10 steps" (right number, wrong reason: they only get one round, ask whether they can still get 10).

STAGE 1B, THE SMALL CASE (right after Stage 1, as a quick check that they can really build the assignment; about 3 minutes). Say: "Let's make it concrete. Only 8 bottles, numbered 0 to 7, one is poisoned, same rules: one round, 24 hours. You have 3 testers, A, B and C. Tell me which bottles each tester drinks." Then ask them to lay it out as a table: for each bottle, which testers drink it, writing 0 when a tester does not drink it, in the order A B C. The answer you expect, with A as the 4s bit, B as the 2s bit and C as the 1s bit: bottle 0 is 0 0 0 (nobody drinks it), bottle 1 is 0 0 1, bottle 2 is 0 1 0, bottle 3 is 0 1 1, bottle 4 is 1 0 0, bottle 5 is 1 0 1, bottle 6 is 1 1 0, bottle 7 is 1 1 1. So A drinks 4, 5, 6, 7; B drinks 2, 3, 6, 7; C drinks 1, 3, 5, 7. Any labelling that gives all 8 bottles a different pattern is fine. Then test the plan: "If only A and C die, which bottle is poisoned?" (5), "If nobody dies?" (bottle 0), "If all three die?" (7). If the table has two bottles with the same pattern, let them find that themselves by asking what they would see for those two bottles. If they cannot start, do not coach them; wait for an unlocked hint. Afterwards link back with: "How does this scale to 1,000 bottles?" and let them answer.

STAGE 2. When Stage 1 is done say: "Now the poison kills in exactly 24 hours and you have 48 hours. Can you do better than 10?" Follow-ups: "A tester dies in round 1. Who drinks their round-2 bottles?" (nobody needs to), "What if you had 3 rounds? r rounds?", "Could choosing the round-2 drinks based on the round-1 results ever beat 7?" (no: outcomes per tester are still 3).
Common wrong answers: "still 10" or "5 per round" (ask them to list everything that can happen to one tester); 7 but the round-2 plan breaks when a tester dies early (ask what happens to the round-2 bottles of a tester who died in round 1).

BONUS (only if they finished Stage 2 comfortably). Say: "The poison kills in exactly 20 hours, you have 24, and you can see the hour each person dies." A strong candidate reaches 4 testers quickly by counting outcomes. If they say "still 7" or "10", ask: "How many different things can happen to one tester now?"

STAGE 3. Say: "Back to one round, 24 hours. But now exactly two bottles are poisoned. You still want to identify both." If they are unsure what is asked, restate it: "Everyone drinks once at the same time, you look at who died, and from that alone you must name both bottles, for any possible pair."
Expect, in this order: (1) most candidates first try the Stage 1 binary plan. Let them. If they do not notice the problem themselves, ask "Does this plan still work for two poisoned bottles? Test it on a small example of your own." and let them find the collision. Never supply the example bottles yourself. (2) Ask for a lower bound: "Whatever the plan, how many testers must it use at minimum?" (the number of pairs is 499,500, so 19). (3) Ask for any complete plan; if they say one tester per bottle (1,000), accept it and ask for better. (4) The common next step is rows and columns on a grid (64 testers): ask them to test it on an example of their own and let them find the ambiguity (you may use the words row and column only after they have used them). (5) Strong candidates propose a third direction (diagonals) or similar: ask them to explain why no clean bottle can look poisoned.
Common wrong answers: "20, two per bit" as a final answer (ask: bottles 0 and 3 are poisoned, which pair do you report?); "64, rows and columns" as a final answer (ask: the poisoned bottles are at row 1 column 5 and row 3 column 4, what else fits?).
Follow-ups for strong candidates: "Your plan uses 96 testers and the lower bound is 19: where do you think the truth is?", "How would your plan change if 3 bottles were poisoned?", "If you were allowed a second round, how would you use it?"

IF THE CANDIDATE SAYS "I ALREADY EXPLAINED THIS": do not accept or repeat the earlier answer and do not fill it in for them. Ask them to explain it again, clearly and completely, step by step. Only the explanation they give after you ask counts.

Signals worth more than the final number: uses a counting argument without being prompted, tests their own plan on a small example before claiming it works, finds a counterexample to their own idea, stays calm and structured when the problem has no neat answer. Remember how far they got and how much help they needed (for example "Stage 2 solved with 1 hint; Stage 3 reached the lower bound but no complete plan").`,
  probes: [
    "Can you prove that one fewer tester is not enough?",
    "How many different things can happen to one tester?",
    "Can you write down two different pairs of bottles that give the same dead set?",
    "Test your plan on a small example before you tell me it works.",
  ],
  rubric: [],
};

// ─── validate and emit SQL ──────────────────────────────────────────────────
const fail = (what, errors) => { console.error(`INVALID ${what}:\n - ${errors.join("\n - ")}`); process.exit(1); };
const items = [];
for (const p of [treeLocking, kthObstacle, goodSubarrays, koko, trie]) {
  const v = rb.validateProblemRunbook(p.runbook);
  if (!v.ok) fail(p.title, v.errors);
  items.push({ table: "problems", ...p, runbook: v.value });
}
const pz = rb.validatePuzzleRunbook(poisonedWine.runbook);
if (!pz.ok) fail(poisonedWine.title, pz.errors);
const flow = rb.validateInterviewRunbook(poisonedWineFlow);
if (!flow.ok) fail(poisonedWineFlow.name, flow.errors);

const q = (s) => "$q$" + s + "$q$";
const arr = (a) => "ARRAY[" + a.map(q).join(",") + "]::text[]";
const creator = `(SELECT id FROM users WHERE lower(email) = ${q(CREATOR_EMAIL.toLowerCase())} LIMIT 1)`;
const out = ["-- Generated by scripts/seed/evaluation-content.mjs. Safe to run more than once.", "BEGIN;"];
for (const it of items) {
  out.push(`INSERT INTO problems (org_id, title, difficulty, tags, runbook, kind, created_by)
SELECT '${ORG}', ${q(it.title)}, ${q(it.difficulty)}, ${arr(it.tags)}, ${q(JSON.stringify(it.runbook))}::jsonb, '${it.kind}', ${creator}
WHERE NOT EXISTS (SELECT 1 FROM problems WHERE org_id = '${ORG}' AND title = ${q(it.title)});`);
}
out.push(`INSERT INTO puzzles (org_id, title, difficulty, tags, expected_min, runbook, created_by)
SELECT '${ORG}', ${q(poisonedWine.title)}, ${q(poisonedWine.difficulty)}, ${arr(poisonedWine.tags)}, ${pz.value.expectedMin}, ${q(JSON.stringify(pz.value))}::jsonb, ${creator}
WHERE NOT EXISTS (SELECT 1 FROM puzzles WHERE org_id = '${ORG}' AND title = ${q(poisonedWine.title)});`);
out.push(`INSERT INTO runbooks (org_id, kind, name, description, instructions, probes, rubric, created_by)
SELECT '${ORG}', 'puzzle', ${q(flow.value.name)}, ${q(flow.value.description)}, ${q(flow.value.instructions)}, ${q(JSON.stringify(flow.value.probes))}::jsonb, ${q(JSON.stringify(flow.value.rubric))}::jsonb, ${creator}
WHERE NOT EXISTS (SELECT 1 FROM runbooks WHERE org_id = '${ORG}' AND kind = 'puzzle' AND name = ${q(flow.value.name)});`);
// The two example items seeded earlier would otherwise be picked by "random from all": archive them (reversible).
if (process.env.ARCHIVE_EXAMPLES !== "0") {
  out.push(`UPDATE problems SET is_archived = true, updated_at = NOW() WHERE org_id = '${ORG}' AND title IN ('Two Sum') AND kind = 'dsa' AND is_archived = false;`);
  out.push(`UPDATE puzzles SET is_archived = true, updated_at = NOW() WHERE org_id = '${ORG}' AND title IN ('Two ropes') AND is_archived = false;`);
}
out.push("COMMIT;");
process.stdout.write(out.join("\n") + "\n");
console.error(`ok: ${items.length} problems (${items.filter((i) => i.kind === "parta").length} Part A, ${items.filter((i) => i.kind === "dsa").length} DSA), 1 puzzle, 1 puzzle runbook validated`);
