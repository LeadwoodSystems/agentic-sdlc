// Parses and validates a mutation manifest. Pure: takes the JSON text, returns
// the validated manifest, throws with everything wrong at once.
//
// WHY ONE THROW, NOT THE FIRST PROBLEM: a manifest is authored blind — the
// model writes twelve anchors against files it is not looking at — so its
// mistakes come in batches. Reporting them one per run turns a twelve-mutation
// manifest into twelve edit/re-run cycles, which is the same cost shape this
// whole tool exists to remove. The one exception is malformed JSON: nothing
// further can be checked, so it throws immediately.
//
// The required-field list is deliberately strict about `expectRed`. It is what
// turns "the test went red" into "the test went red FOR THE REASON PREDICTED",
// and a run without it cannot distinguish a genuine RED from collateral damage.
// Optional here would mean optional in practice.

const REQUIRED_STRING_FIELDS = ['file', 'find', 'expectRed'];

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function validateTestCommand(raw, problems) {
  if (typeof raw.testCommand === 'string') {
    // Named specifically because this is the shape the design spec declined,
    // and it is the shape anyone copying the source proposal's example will
    // write. A silent coercion to argv would reintroduce shell-splitting.
    problems.push(
      'testCommand must be an array of strings, not a string — write '
      + '["node", "--test"] rather than "node --test", so no shell is involved.',
    );
    return;
  }
  if (!isStringArray(raw.testCommand) || raw.testCommand.length === 0) {
    problems.push('testCommand must be an array of strings with at least one element.');
  }
}

function validateMutation(mutation, index, seenIds, problems) {
  // `mutation #<index>` rather than `mutation undefined` when the id itself is
  // what's missing — otherwise every anonymous entry reports identically and
  // none of them can be found.
  const hasId = typeof mutation.id === 'string' && mutation.id.length > 0;
  const label = hasId ? `mutation ${mutation.id}` : `mutation #${index}`;

  if (!hasId) {
    problems.push(`${label}: id must be a non-empty string.`);
  } else if (seenIds.has(mutation.id)) {
    // Results are keyed by id in the report and selected by id via --only, so
    // duplicates would silently drop one of the two.
    problems.push(`${label}: duplicate mutation id "${mutation.id}".`);
  } else {
    seenIds.add(mutation.id);
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof mutation[field] !== 'string' || mutation[field].length === 0) {
      problems.push(`${label}: ${field} must be a non-empty string.`);
    }
  }

  // `replace` is required but MAY be empty: deleting the anchor entirely is a
  // legitimate — often the sharpest — mutation.
  if (typeof mutation.replace !== 'string') {
    problems.push(`${label}: replace must be a string (empty is allowed — deleting the anchor is a valid mutation).`);
  }

  if (mutation.testArgs !== undefined && !isStringArray(mutation.testArgs)) {
    problems.push(`${label}: testArgs must be an array of strings when present.`);
  }

  for (const field of ['why', 'label']) {
    if (mutation[field] !== undefined && typeof mutation[field] !== 'string') {
      problems.push(`${label}: ${field} must be a string when present.`);
    }
  }
}

function parseManifest(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid manifest: manifest is not valid JSON — ${err.message}`);
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid manifest: manifest must be a JSON object.');
  }

  const problems = [];
  validateTestCommand(raw, problems);

  if (raw.cwd !== undefined && typeof raw.cwd !== 'string') {
    problems.push('cwd must be a string when present.');
  }
  if (raw.env !== undefined && (raw.env === null || typeof raw.env !== 'object' || Array.isArray(raw.env))) {
    problems.push('env must be an object of string values when present.');
  }

  if (!Array.isArray(raw.mutations)) {
    problems.push('mutations must be an array.');
  } else if (raw.mutations.length === 0) {
    problems.push('mutations must contain at least one mutation.');
  } else {
    const seenIds = new Set();
    raw.mutations.forEach((mutation, index) => {
      if (mutation === null || typeof mutation !== 'object' || Array.isArray(mutation)) {
        problems.push(`mutation #${index}: must be an object.`);
        return;
      }
      validateMutation(mutation, index, seenIds, problems);
    });
  }

  if (problems.length > 0) {
    throw new Error(`Invalid manifest:\n${problems.join('\n')}`);
  }

  return {
    testCommand: raw.testCommand,
    ...(raw.cwd !== undefined ? { cwd: raw.cwd } : {}),
    ...(raw.env !== undefined ? { env: raw.env } : {}),
    mutations: raw.mutations,
  };
}

module.exports = { parseManifest };
