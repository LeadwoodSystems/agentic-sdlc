// Applies one literal find/replace to a source string, reporting WHY it could
// not rather than guessing. Pure — no I/O — which is what makes the line-ending
// and encoding rules below testable without a repo on disk.
//
// WHY THIS EXISTS: the mutation loop it serves was hand-rolled four times in
// gaw v0.13-s8, and every one of that sprint's three bug classes lived in this
// step. The two that matter here:
//
//   1. Anchors were authored with '\n' and matched against CRLF files, so 3 of
//      8 mutations reported ANCHOR NOT FOUND. Two of those three later proved
//      to be genuine REDs — evidence lost to a line ending.
//   2. A PowerShell `Get-Content -Raw` / `Set-Content` round-trip read a
//      BOM-less UTF-8 file as ANSI and wrote back mojibake, destroying every
//      em-dash in the file. Nothing here may round-trip through a codec.
//
// LINE ENDINGS — the load-bearing decision. `find`/`replace` arrive authored
// with '\n' (a model writes them into JSON) while the file on disk is CRLF, so
// something must be converted. This module converts THE ANCHOR INTO THE FILE'S
// ending and matches against the ORIGINAL source. It never normalizes the
// source.
//
// The source proposal phrased the rule the other way — normalize both sides to
// '\n', then re-emit in the file's dominant ending. That is subtly wrong for a
// MIXED-ending file: round-tripping the whole source promotes every lone '\n'
// to '\r\n', changing bytes far outside the mutation. The caller then compares
// the reverted file against the original, finds it different, and reports
// DIRTY-REVERT — aborting a run for damage the tool itself caused. Normalizing
// only the anchor leaves everything outside the matched span byte-identical by
// construction. Its failure mode is an anchor spanning a mixed region reporting
// ANCHOR-MISS: loud, and the safe direction.
const { detectEol } = require('./marker-block');

function applyMutation(source, find, replace) {
  const eol = detectEol(source);
  const toEol = (s) => String(s).replace(/\r\n/g, '\n').replace(/\n/g, eol);
  const anchor = toEol(find);
  const body = toEol(replace);

  const at = source.indexOf(anchor);
  if (at === -1) return { verdict: 'ANCHOR-MISS', result: null };

  // Searching from at+1 rather than at+anchor.length so OVERLAPPING occurrences
  // count too ('aa' in 'aaa'). Over-reporting ambiguity is the safe direction:
  // the cost of a false ambiguous is a rewritten anchor, whereas silently
  // mutating one of several identical sites produces a verdict that READS as
  // evidence and is not — the same failure class as a silently skipped
  // mutation, which is what this whole tool exists to prevent.
  if (source.indexOf(anchor, at + 1) !== -1) {
    return { verdict: 'AMBIGUOUS-ANCHOR', result: null };
  }

  const result = source.slice(0, at) + body + source.slice(at + anchor.length);

  // A mutation that cannot change the file cannot change behaviour, so a GREEN
  // from it would be meaningless. Caught here rather than left to the caller.
  if (result === source) return { verdict: 'NO-OP', result: null };

  return { verdict: 'APPLIED', result };
}

module.exports = { applyMutation };
