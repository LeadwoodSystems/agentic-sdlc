// Lint a CLAUDE.md for the four decay patterns that make a durable-context file
// stop working, all four observed in a real one (GAW's):
//
//   1. facts-block   — numbers nobody re-measured, or no measured block at all.
//   2. retired-rule  — a dead rule kept alive because it holds a NUMBER.
//   3. long-rule     — a rule so long it is no longer an instruction.
//   4. contradiction — the same thing asserted twice, differently.
//
// WHY 2 IS ITS OWN RULE: GAW's operating rule 4 is dead. It survives only so
// that historical citations of "rule 6" and "rule 7" still point at rule 6 and
// rule 7 — the numbering is load-bearing, so the corpse cannot be removed
// without silently renumbering every rule below it and invalidating every
// reference written before today. Positional identifiers create that ratchet:
// each retirement either breaks citations or leaves a tombstone, and a file
// accumulates tombstones forever. Stable slugs cost nothing and remove the
// choice, which is why this lint's fix is always "give the rules slugs", never
// "reword the tombstone".
//
// WHY 3 HAS A NUMBER ON IT: GAW's rule 1 is roughly 700 words. Somewhere well
// before that a rule stops being read as an instruction and starts being read
// as background, and an instruction that is not followed is worse than an
// absent one because it still buys the author confidence. 120 words is a
// judgement call, not a measurement — it is about a screenful, and it is set
// where a rule that needs more room clearly wants to be a reference doc with a
// one-line rule pointing at it.
//
// Every finding is reported; the run never stops at the first. A lint that
// makes you re-run it to see the next problem gets run once.

const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./lib/exec');
const { findBlock } = require('./lib/marker-block');
const { FACTS_MARKERS, computeFactsUpdate } = require('./facts');

const CLAUDE_MD_BASENAME = 'CLAUDE.md';
const MAX_RULE_WORDS = 120;

// A rule this short whose opening sentence announces its own death is a
// tombstone. See TOMBSTONE_TERMS below for why both signals are required.
const TOMBSTONE_MAX_WORDS = 30;
const TOMBSTONE_TERMS = /\b(retired|removed|no longer|superseded)\b/i;

// Headings that introduce the operating rules. Matched loosely because the
// skeleton's wording ("How we work (operating rules)") is a suggestion projects
// reword; the checks below simply do not run on a file that names its rules
// section something entirely different, which is the safe direction — a lint
// that guesses which prose is a "rule" would fire on the architecture map.
const RULES_HEADING = /operating rules|how we work/i;

const HEADING = /^(#{1,6})\s+(.*)$/;
// Indent capped at 3 spaces: markdown needs 4 to nest, so `    1. foo` is a
// sub-list inside the rule above it, not a new rule.
const ORDERED_ITEM = /^ {0,3}(\d+)\.\s+(.*)$/;
const FENCE = /^\s*```/;

// --- text helpers -----------------------------------------------------------

function firstSentence(text) {
  const firstLine = text.split('\n')[0];
  const stop = firstLine.search(/[.!?](\s|$)/);
  return stop === -1 ? firstLine : firstLine.slice(0, stop + 1);
}

// Fenced code is excluded: a rule that carries a five-line command block is not
// asking the reader to hold five lines of prose in their head, and counting the
// block would push a perfectly readable rule over the limit.
function countWords(text) {
  const withoutFences = String(text).replace(/```[\s\S]*?```/g, ' ');
  return withoutFences.replace(/[*_`~]/g, ' ').split(/\s+/).filter(Boolean).length;
}

function truncate(text, max = 80) {
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function lineOfIndex(content, index) {
  return content.slice(0, index).split('\n').length;
}

// --- rule extraction --------------------------------------------------------

// The rules section runs from its heading to the next heading at the same or a
// higher level. Subheadings stay inside it, which is what makes the slug form
// (`### checkpoint-every-sprint`) parse as rules rather than as section breaks.
function findRulesSection(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const heading = lines[i].match(HEADING);
    if (!heading || !RULES_HEADING.test(heading[2])) continue;
    const level = heading[1].length;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j].match(HEADING);
      if (next && next[1].length <= level) {
        end = j;
        break;
      }
    }
    return { start: i + 1, end };
  }
  return null;
}

// A rule is `{ number, slug, line, text }`. `number` is null for the slug form,
// and that difference is load-bearing: only a NUMBERED rule is under pressure to
// stay in place after it dies, so only a numbered rule can be a tombstone.
function extractRules(content) {
  const lines = String(content).split(/\r?\n/);
  const section = findRulesSection(lines);
  if (!section) return [];

  const rules = [];
  let current = null;
  let inFence = false;
  const close = () => {
    if (current) rules.push({ ...current, text: current.lines.join('\n').trim() });
    current = null;
  };

  for (let i = section.start; i < section.end; i += 1) {
    const line = lines[i];
    if (FENCE.test(line)) inFence = !inFence;

    // Inside a fence, a line that looks like `1. foo` is sample output, not a
    // new rule, so the boundary tests are skipped there entirely.
    if (!inFence) {
      const ordered = line.match(ORDERED_ITEM);
      if (ordered) {
        close();
        current = { number: Number(ordered[1]), slug: null, line: i + 1, lines: [ordered[2]] };
        continue;
      }
      const heading = line.match(HEADING);
      if (heading) {
        close();
        current = { number: null, slug: heading[2].trim(), line: i + 1, lines: [] };
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  close();
  return rules;
}

function ruleName(rule) {
  return rule.number === null ? `Operating rule "${rule.slug}"` : `Operating rule ${rule.number}`;
}

// --- check 2: a retired rule holding a numbered slot ------------------------

// TWO signals are required, and neither alone would do:
//
//   * the tombstone term is in the rule's FIRST SENTENCE — a dead rule announces
//     its death up front; a live rule that says "removed" says it in the middle,
//     about something else ("the branch is removed once the PR merges");
//   * the rule is SHORT — a tombstone has nothing left to say.
//
// Requiring both trades recall for precision on purpose. A verbose tombstone
// slips through, which costs a human nothing; a false positive on a live rule
// blocks a commit and teaches people to ignore the lint, which costs everything.
function checkRetiredRules(rules) {
  return rules
    .filter((rule) => rule.number !== null)
    .filter((rule) => TOMBSTONE_TERMS.test(firstSentence(rule.text))
      && countWords(rule.text) <= TOMBSTONE_MAX_WORDS)
    .map((rule) => ({
      rule: 'retired-rule',
      line: rule.line,
      message: `${ruleName(rule)} reads as a tombstone ("${truncate(rule.text, 60)}") — a dead rule kept only so the numbers below it do not shift. Delete it and give the rules stable slugs, so a citation names the rule instead of its position.`,
    }));
}

// --- check 3: a rule too long to be followed --------------------------------

function checkRuleLength(rules, { maxWords = MAX_RULE_WORDS } = {}) {
  return rules
    .map((rule) => ({ rule, words: countWords(rule.text) }))
    .filter(({ words }) => words > maxWords)
    .map(({ rule, words }) => ({
      rule: 'long-rule',
      line: rule.line,
      message: `${ruleName(rule)} is ${words} words (limit ${maxWords}) — past roughly this length a rule is read as background, not as an instruction. Cut it to its imperative and move the reasoning into a reference doc the rule cites.`,
    }));
}

// --- check 4: a file that contradicts itself --------------------------------
//
// WHAT THIS CAN CATCH, and nothing beyond it. Full natural-language inference is
// out of reach here, so this is deliberately two narrow, mechanical detectors
// over the shapes a CLAUDE.md actually uses:
//
//   (a) DUPLICATE KEY, DIFFERENT NUMBER. `key: value` lines — including the
//       measured facts block's own `- label: **802**` items — where the same key
//       carries a different set of digits. This is the drift class the facts
//       block exists to kill: the block says 802 and a paragraph three sections
//       down still says 722.
//
//   (b) ONE SUBJECT, OPPOSING POLARITY. A backticked subject described in one
//       line with a term from one side of a fixed antonym table and in another
//       line with a term from the other side. GAW's `CLAUDE.md` called the
//       `deep` test tier "the authoritative gate on every PR" in one section and
//       "advisory, AFTER merge" in another — two readers, two behaviours.
//
// WHAT IT CANNOT CATCH — and a lint that lets you believe otherwise is itself
// the stale prose it is meant to find:
//
//   * NEGATION. "`deep` is not advisory" is read as the word "advisory". Lines
//     naming both sides at once are therefore skipped rather than guessed at.
//   * PARAPHRASE. Only the terms in POLARITY_GROUPS are known. "`deep` blocks
//     the release" vs "`deep` is a courtesy" is invisible.
//   * ANY CONTRADICTION WITHOUT A SHARED HANDLE — no repeated `key:`, no shared
//     backticked subject. Two paragraphs of free prose disagreeing about the
//     same idea in different words will pass.
//   * CROSS-FILE DISAGREEMENT. Scope is one file; a CLAUDE.md perfectly
//     consistent with itself and wrong about the code passes cleanly. Only
//     `facts.js` closes that gap, by measuring instead of reading.
//   * NON-NUMERIC VALUE DRIFT ("the port is high" vs "the port is 3000").
//
// It is a smoke detector, not a proof system. It fires on the shapes that have
// actually burned this project, and stays silent everywhere else.

// `:\s+` (colon then whitespace) rather than `:` — this is what keeps
// `https://example.com/v2` out of the key/value set, since a URL's colon is
// followed by a slash. Cheaper and more robust than a URL exclusion list.
const KEY_VALUE = /^\s*(?:[-*+]\s+)?(.{1,60}?)\s*:\s+(\S.*)$/;

const POLARITY_GROUPS = [
  {
    name: 'enforcement',
    a: /\b(authoritative|blocking|mandatory|required|gate|gates|must pass)\b/i,
    b: /\b(advisory|optional|informational|non-blocking|best[- ]effort)\b/i,
  },
  {
    name: 'timing',
    a: /\b(before merge|pre-?merge|on every pr|prior to merge)\b/i,
    b: /\b(after merge|post-?merge|once merged|after the merge)\b/i,
  },
];

function normalizeKey(key) {
  return key.replace(/[*_`~]/g, '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,;]+$/, '');
}

// URLs are stripped before the digits are read. `:\s+` above already stops a
// URL's own colon from being mistaken for the key/value separator, but a URL as
// the VALUE ("- Docs: https://example.com/v2/guide") still carries digits that
// mean nothing here — two links to two doc versions are not a contradiction.
// Digits alongside a link ("https://… (3 pages)") are still compared.
function numbersIn(value) {
  const withoutUrls = value.replace(/\bhttps?:\/\/\S+/gi, ' ');
  return (withoutUrls.match(/\d+(?:\.\d+)?/g) || []).join(',');
}

function checkDuplicateKeyValues(lines) {
  const seen = new Map();
  const findings = [];
  lines.forEach((rawLine, index) => {
    const match = rawLine.match(KEY_VALUE);
    if (!match) return;
    const key = normalizeKey(match[1]);
    const value = match[2].trim();
    // Only value drift that shows up as DIGITS is judged. A key whose value is
    // prose ("- Git: branch per sprint") legitimately recurs with different
    // wording in different sections, and flagging that would drown the useful
    // signal — ports, counts, versions and timings — in noise.
    const digits = numbersIn(value);
    if (key === '' || digits === '') return;

    const previous = seen.get(key);
    if (!previous) {
      seen.set(key, { line: index + 1, value, digits });
      return;
    }
    if (previous.digits === digits) return;
    findings.push({
      rule: 'contradiction',
      line: index + 1,
      message: `"${key}" is asserted as "${truncate(value, 40)}" here and as "${truncate(previous.value, 40)}" on line ${previous.line}. One of them is stale — measure it in .asdlc/facts.json so neither has to be trusted.`,
    });
  });
  return findings;
}

function checkPolarityConflicts(lines) {
  // subject -> group name -> { a: line, b: line } (first sighting of each side)
  const sightings = new Map();
  // One finding per (subject, pair of lines). The `deep` example trips BOTH
  // groups at once — "authoritative gate on every PR" vs "advisory … after
  // merge" — and reporting it twice would suggest two problems where the author
  // has one sentence to fix. The finding is about the contradicting pair, not
  // about how many antonym tables happened to notice it.
  const reportedPairs = new Set();
  const findings = [];

  lines.forEach((rawLine, index) => {
    const subjects = (rawLine.match(/`[^`\n]{1,40}`/g) || []).map((s) => s.toLowerCase());
    if (subjects.length === 0) return;

    for (const group of POLARITY_GROUPS) {
      const hitsA = group.a.test(rawLine);
      const hitsB = group.b.test(rawLine);
      // Equal means either neither side is present (this line says nothing
      // about this group) or BOTH are — and both on one line is almost always a
      // contrast the author drew on purpose ("advisory, not an authoritative
      // gate"). See the NEGATION note above: that case is skipped, not resolved.
      if (hitsA === hitsB) continue;
      const side = hitsA ? 'a' : 'b';
      const other = hitsA ? 'b' : 'a';

      for (const subject of new Set(subjects)) {
        if (!sightings.has(subject)) sightings.set(subject, {});
        const bySubject = sightings.get(subject);
        const record = bySubject[group.name] || (bySubject[group.name] = {});
        const pairKey = record[other] ? `${subject}|${record[other].line}|${index + 1}` : null;
        if (pairKey && !reportedPairs.has(pairKey)) {
          reportedPairs.add(pairKey);
          findings.push({
            rule: 'contradiction',
            line: index + 1,
            message: `${subject} is described as "${truncate(rawLine, 50)}" here, but line ${record[other].line} says "${truncate(record[other].text, 50)}". Two readers will behave differently — decide which is true and delete the other.`,
          });
        }
        if (!record[side]) record[side] = { line: index + 1, text: rawLine };
      }
    }
  });
  return findings;
}

function checkContradictions(content) {
  const lines = String(content).split(/\r?\n/);
  return [...checkDuplicateKeyValues(lines), ...checkPolarityConflicts(lines)];
}

// --- check 1: the measured facts block --------------------------------------

// Delegates wholesale to facts.js rather than re-deriving staleness: there must
// be exactly one definition of "the block is current", or the lint and the
// writer will disagree and the disagreement will be resolved by whoever ran last.
function checkFactsBlock(content, claudeMdPath, { cwd, runner = run } = {}) {
  // Checked FIRST, before the block is even looked for. facts.js resolves
  // `<cwd>/CLAUDE.md` from the manifest's directory, so for any other filename
  // there is no measurable block to have an opinion about — and quietly
  // measuring the CLAUDE.md sitting next to it would report a green (or red)
  // result about a file the caller did not ask about, which is worse than
  // saying nothing.
  if (path.basename(claudeMdPath) !== CLAUDE_MD_BASENAME) {
    return [{
      rule: 'facts-block',
      line: 1,
      message: `Cannot verify a facts block here: \`facts.js\` only ever measures ${CLAUDE_MD_BASENAME}, and this file is ${path.basename(claudeMdPath)}.`,
    }];
  }

  const block = findBlock(content, FACTS_MARKERS);
  if (!block.found) {
    return [{
      rule: 'facts-block',
      line: 1,
      message: `No ${FACTS_MARKERS.start} block — every number in this file is then an assertion nobody re-measured. Declare the facts in .asdlc/facts.json and run \`node scripts/asdlc/facts.js\`.`,
    }];
  }
  if (block.error) {
    return [{ rule: 'facts-block', line: lineOfIndex(content, block.start), message: block.error }];
  }

  let update;
  try {
    update = computeFactsUpdate(cwd, { runner });
  } catch (err) {
    // A missing or malformed .asdlc/facts.json lands here. It IS a finding: a
    // block that cannot be re-derived is indistinguishable from a hand-written
    // one, which is the state this whole check exists to forbid.
    return [{
      rule: 'facts-block',
      line: lineOfIndex(content, block.start),
      message: `Facts block cannot be verified: ${err.message}`,
    }];
  }

  if (!update.changed) return [];
  return [{
    rule: 'facts-block',
    line: lineOfIndex(content, block.start),
    message: 'Facts block is stale — the declared commands measure something else now. Run `node scripts/asdlc/facts.js` to refresh it.',
  }];
  // NOTE: a block already recording `**UNMEASURED**` for a command that still
  // fails is NOT flagged, matching `facts.js --check` exactly. The block is
  // honest about the gap; facts.js already exits non-zero when it writes one, so
  // failing here as well would report the same problem twice, from the tool
  // least able to explain it.
}

// --- aggregate --------------------------------------------------------------

function lintClaudeMd(claudeMdPath, { runner = run, cwd } = {}) {
  const resolved = path.resolve(claudeMdPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${claudeMdPath} not found (looked in ${resolved}).`);
  }
  const content = fs.readFileSync(resolved, 'utf8');
  const rules = extractRules(content);

  const findings = [
    ...checkFactsBlock(content, resolved, { cwd: cwd || path.dirname(resolved), runner }),
    ...checkRetiredRules(rules),
    ...checkRuleLength(rules),
    ...checkContradictions(content),
  ];
  // Sorted by line so the output reads down the file the way the author does.
  return findings.sort((x, y) => x.line - y.line);
}

function formatFinding(finding, displayPath) {
  return `${displayPath}:${finding.line}: ${finding.rule}: ${finding.message}`;
}

function main(argv = process.argv.slice(2), { cwd = process.cwd(), runner = run } = {}) {
  if (argv.length > 1) {
    console.error(`asdlc-lint.js: expected at most one path, got: ${argv.join(', ')}`);
    console.error('Usage: node scripts/asdlc/asdlc-lint.js [path-to-CLAUDE.md]');
    process.exitCode = 1;
    return 1;
  }
  const displayPath = argv[0] || CLAUDE_MD_BASENAME;

  let findings;
  try {
    findings = lintClaudeMd(path.resolve(cwd, displayPath), { runner });
  } catch (err) {
    // Configuration problems all carry a written-out message; printing the
    // message alone keeps the CLI readable, and a stack here would only ever
    // point at this file.
    console.error(`asdlc-lint.js: ${err.message}`);
    process.exitCode = 1;
    return 1;
  }

  for (const finding of findings) {
    console.error(formatFinding(finding, displayPath));
  }

  if (findings.length > 0) {
    console.error(`${findings.length} finding(s) in ${displayPath}.`);
    process.exitCode = 1;
    return 1;
  }
  console.log(`${displayPath} is clean.`);
  return 0;
}

module.exports = {
  MAX_RULE_WORDS,
  TOMBSTONE_MAX_WORDS,
  POLARITY_GROUPS,
  countWords,
  extractRules,
  checkFactsBlock,
  checkRetiredRules,
  checkRuleLength,
  checkContradictions,
  lintClaudeMd,
  formatFinding,
  main,
};

if (require.main === module) {
  main();
}
