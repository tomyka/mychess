// CRAP (Change Risk Anti-Patterns) gate for TypeScript.
//   CRAP(fn) = complexity^2 * (1 - coverage)^3 + complexity
// complexity = cyclomatic complexity computed from the TypeScript AST
// coverage   = statement coverage of the function, from coverage/coverage-final.json (Vitest v8/istanbul)
//
// Usage: node quality/crap.mjs                 -> fail on functions above the limit (minus baseline)
//        node quality/crap.mjs --write-baseline -> accept current offenders (for existing projects)
//        node quality/crap.mjs --top 20         -> print the 20 riskiest functions (no gating)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { ROOT, listFiles, loadConfig, matchesAny, toRel } from './lib.mjs';

const ts = createRequire(join(ROOT, 'package.json'))('typescript');
const config = loadConfig();
const args = process.argv.slice(2);
const coveragePath = join(ROOT, 'coverage', 'coverage-final.json');

function loadCoverage() {
  if (!existsSync(coveragePath)) {
    console.error(
      'No coverage/coverage-final.json. Run the tests with coverage first (gate "test").',
    );
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(coveragePath, 'utf8'));
  const byRel = new Map();
  for (const [file, data] of Object.entries(raw))
    byRel.set(toRel(resolve(ROOT, file)), data);
  return byRel;
}

const DECISION_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CatchClause,
]);
const LOGICAL_OPS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function complexityOf(fn) {
  let c = 1;
  const visit = (node) => {
    if (node !== fn && isFunctionLike(node)) return; // nested functions are scored separately
    if (DECISION_KINDS.has(node.kind)) c++;
    if (ts.isBinaryExpression(node) && LOGICAL_OPS.has(node.operatorToken.kind))
      c++;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn, visit);
  return c;
}

function nameOf(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  const p = node.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name))
    return p.name.text;
  if (p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name))
    return p.name.text;
  if (p && ts.isPropertyDeclaration(p) && ts.isIdentifier(p.name))
    return p.name.text;
  return '<anonymous>';
}

function coverageOf(fileCov, startLine, endLine) {
  if (!fileCov) return 0;
  let total = 0;
  let covered = 0;
  for (const [id, loc] of Object.entries(fileCov.statementMap)) {
    if (loc.start.line >= startLine && loc.end.line <= endLine) {
      total++;
      if (fileCov.s[id] > 0) covered++;
    }
  }
  return total === 0 ? 1 : covered / total;
}

function analyse() {
  const coverage = loadCoverage();
  const files = listFiles(config.sourceGlobs).filter(
    (f) => !matchesAny(f, config.testGlobs),
  );
  const results = [];
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const seen = new Map();
    const visit = (node) => {
      if (isFunctionLike(node) && node.body) {
        const start =
          sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
        const name = nameOf(node);
        const n = (seen.get(name) ?? 0) + 1;
        seen.set(name, n);
        const complexity = complexityOf(node);
        const cov = coverageOf(coverage.get(file), start, end);
        const crap = complexity ** 2 * (1 - cov) ** 3 + complexity;
        results.push({
          key: `${file}::${name}${n > 1 ? `#${n}` : ''}`,
          file,
          line: start,
          name,
          complexity,
          coverage: Math.round(cov * 100),
          crap: Math.round(crap * 10) / 10,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return results.sort((a, b) => b.crap - a.crap);
}

function fmt(r) {
  return `  ${r.file}:${r.line} ${r.name}  CRAP=${r.crap} (complexity ${r.complexity}, coverage ${r.coverage}%)`;
}

const results = analyse();
const max = config.crap.max;
const baselinePath = join(ROOT, config.crap.baselineFile);

if (args.includes('--top')) {
  const n = Number(args[args.indexOf('--top') + 1] ?? 20);
  console.log(`Top ${n} riskiest functions:`);
  results.slice(0, n).forEach((r) => console.log(fmt(r)));
  process.exit(0);
}

const offenders = results.filter((r) => r.crap > max);

if (args.includes('--write-baseline')) {
  const baseline = Object.fromEntries(offenders.map((r) => [r.key, r.crap]));
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `Baseline written: ${offenders.length} existing function(s) above CRAP ${max} accepted.`,
  );
  process.exit(0);
}

const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8'))
  : {};
const failures = offenders.filter(
  (r) => !(r.key in baseline) || r.crap > baseline[r.key],
);
const tolerated = offenders.length - failures.length;

if (failures.length > 0) {
  console.log(
    `CRAP gate FAILED: ${failures.length} function(s) above ${max} (or worse than baseline).`,
  );
  console.log(
    'Fix by adding tests that cover these functions, or by splitting them into simpler functions:',
  );
  failures.forEach((r) => console.log(fmt(r)));
  process.exit(1);
}
console.log(
  `CRAP gate passed: ${results.length} functions analysed, no new or worsened function above ${max}` +
    (tolerated
      ? ` (${tolerated} legacy function(s) tolerated by baseline).`
      : '.'),
);
