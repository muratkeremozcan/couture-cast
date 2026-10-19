#!/usr/bin/env python3
"""Mutation evidence for the Story 6.4 shared comments client tests.

Copies packages/api-client into a scratch work tree, mutates the COPY only, runs the real
spec files with the real vitest config, and records per mutant: file:line, original and
mutated snippet, killing tests (tests that pass on the unmutated copy and fail on the
mutant), and killed/survived. Production source is never written. Evidence files are
refreshed beside this script.

Usage: python3 -I mutation-client.py
Target only the CR6 guard regression: python3 -I mutation-client.py --only-cr6
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
PKG = os.path.join(REPO, 'packages/api-client')
HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'mutation-client-work')
COPY = os.path.join(WORK, 'packages/api-client')
VITEST = os.path.join(REPO, 'node_modules/.bin/vitest')
SPECS = [
    'testing/community-comments-state.spec.ts',
    'testing/community-comments-state-outcomes.spec.ts',
    'testing/community-comments-client.spec.ts',
]
STATE = 'src/community-comments-state.ts'
CONTRACT = 'src/contracts/http/community.ts'

# (id, file, original snippet, mutated snippet). Each original must occur exactly once.
MUTANTS = [
    # watchSubmissions (source after the T3 per-cycle ownership fix)
    ('M1 no pending-work check', STATE,
     "        !this.current(postId).submissions.some(\n          (item) => item.status === 'pending_screening'\n        )",
     '        false'),
    ('M2 no 30s backoff cap', STATE,
     'Math.min(30_000, 3000 * 2 ** failures)', '3000 * 2 ** failures'),
    ('M3 failures not reset on success', STATE,
     '? Math.min(failures + 1, 4) : 0', '? Math.min(failures + 1, 4) : failures'),
    ('M5a schedule stopped guard removed', STATE,
     '      if (\n        stopped ||\n        !valid() ||\n        busy ||',
     '      if (\n        !valid() ||\n        busy ||'),
    ('M5b post-poll fence removed', STATE,
     '            if (stopped || !owns() || scheduledCycle !== cycle) return\n', ''),
    ('M6 stop does not clear timer', STATE,
     '      stopped = true\n      if (timer) clearTimeout(timer)\n', '      stopped = true\n'),
    ('M23a schedule ticket guard removed', STATE,
     '        !valid() ||\n        busy ||', '        busy ||'),
    ('M23b timer recheck removed', STATE,
     "          if (\n            stopped ||\n            !owns() ||\n            scheduledCycle !== cycle ||\n"
     "            !this.current(postId).submissions.some(\n"
     "              (item) => item.status === 'pending_screening'\n            )\n          )\n"
     "            return\n", ''),
    ('M23c timer ticket recheck removed', STATE,
     '            stopped ||\n            !owns() ||\n', '            stopped ||\n'),
    ('M23d timer pending recheck removed', STATE,
     "            scheduledCycle !== cycle ||\n            !this.current(postId).submissions.some(\n"
     "              (item) => item.status === 'pending_screening'\n            )\n",
     '            scheduledCycle !== cycle\n'),
    ('M23e timer stopped recheck removed', STATE,
     '          if (\n            stopped ||\n            !owns() ||',
     '          if (\n            !owns() ||'),
    ('M24a per-cycle ticket renewal removed', STATE,
     '        valid = this.ticket(postId)\n', ''),
    ('M24b cycle bump removed', STATE, '        cycle++\n', ''),
    ('M24c whole renewal block removed', STATE,
     '      if (!valid()) {\n        if (timer) clearTimeout(timer)\n        timer = undefined\n'
     '        busy = false\n        failures = 0\n        valid = this.ticket(postId)\n'
     '        cycle++\n      }\n', ''),
    ('M25a invalid old timer not cancelled', STATE,
     '        if (timer) clearTimeout(timer)\n        timer = undefined\n',
     '        timer = undefined\n'),
    ('M25b invalid old timer handle kept', STATE,
     '        if (timer) clearTimeout(timer)\n        timer = undefined\n',
     '        if (timer) clearTimeout(timer)\n'),
    ('M25c renewal keeps busy flag', STATE,
     '        busy = false\n        failures = 0\n', '        failures = 0\n'),
    ('M25d renewal keeps backoff', STATE,
     '        failures = 0\n        valid = this.ticket(postId)\n',
     '        valid = this.ticket(postId)\n'),
    ('M26a timer cycle recheck removed', STATE,
     '            scheduledCycle !== cycle ||\n            !this.current',
     '            !this.current'),
    ('M26b post-poll ticket fence removed', STATE,
     'if (stopped || !owns() || scheduledCycle !== cycle) return',
     'if (stopped || scheduledCycle !== cycle) return'),
    ('M26c post-poll cycle fence removed', STATE,
     'if (stopped || !owns() || scheduledCycle !== cycle) return',
     'if (stopped || !owns()) return'),
    ('M26d post-poll stopped fence removed', STATE,
     'if (stopped || !owns() || scheduledCycle !== cycle) return',
     'if (!owns() || scheduledCycle !== cycle) return'),
    ('M26e timer uses live ticket', STATE, '            !owns() ||\n', '            !valid() ||\n'),
    # failure mapping, announcements, create, reads, suppression, pagination
    ('M4 announce every failure', STATE,
     'if (state.error !== key) this.announce(state, key)', 'this.announce(state, key)'),
    ('M7 consumeAnnouncement replays', STATE,
     '(this.consumedAnnouncements.get(postId) ?? 0) >= announcement.id', 'false'),
    ('M8 create invalidates public reads', STATE,
     'this.statusesPending.delete(postId)\n      this.reconcileSubmissions(',
     'this.invalidateReads(postId)\n      this.reconcileSubmissions('),
    ('M9 429 not definite', STATE, '[400, 403, 409, 429]', '[400, 403, 409]'),
    ('M10 500/503 definite', STATE, '[400, 403, 409, 429]', '[400, 403, 409, 429, 500, 503]'),
    ('M11 load catch unfenced', STATE,
     'if (isCurrent()) this.failed(postId, state, error)', 'this.failed(postId, state, error)'),
    ('M12 delete catch unfenced', STATE,
     '    } catch (error) {\n      if (valid()) {\n        this.failed(postId, state, error)\n'
     '        this.emit()\n      }\n    }\n  }\n\n  async report(',
     '    } catch (error) {\n        this.failed(postId, state, error)\n'
     '        this.emit()\n    }\n  }\n\n  async report('),
    ('M13 erased not suppressed', STATE,
     "['author_deleted', 'consent_suspended', 'erased']",
     "['author_deleted', 'consent_suspended']"),
    ('M14 suppression does not fence reads', STATE,
     '        this.invalidateReads(postId, false)\n', ''),
    ('M15 merge across changed snapshots', STATE,
     'previous.snapshot !== page.snapshot', 'false'),
    ('M16 age_gate maps to generic key', STATE,
     "? 'community.error.ageGate'", "? 'community.comments.failed'"),
    ('M17 request ownership ignored', STATE,
     'return () => valid() && this.requests.get(key) === request', 'return () => valid()'),
    ('M18a page schema not strict', CONTRACT,
     '    hasNewer: z.boolean(),\n  })\n  .strict()',
     '    hasNewer: z.boolean(),\n  })\n  .passthrough()'),
    ('M18b comment schema not strict', CONTRACT,
     '    replyCount: z.number().int().nonnegative(),\n  })\n  .strict()',
     '    replyCount: z.number().int().nonnegative(),\n  })\n  .passthrough()'),
    ('M18c submission schema not strict', CONTRACT,
     '    publicationSequence: z.number().int().positive().nullable(),\n  })\n  .strict()',
     '    publicationSequence: z.number().int().positive().nullable(),\n  })\n  .passthrough()'),
    ('M19 report catch unfenced', STATE,
     '    } catch (error) {\n      if (valid()) {\n        this.failed(postId, state, error)\n'
     '        this.emit()\n      }\n    }\n    return false',
     '    } catch (error) {\n        this.failed(postId, state, error)\n'
     '        this.emit()\n    }\n    return false'),
    ('M20 private poll catch unfenced', STATE,
     '      if (isCurrent()) {\n        this.failed(postId, state, error)\n        this.emit()\n      }',
     '      this.failed(postId, state, error)\n      this.emit()'),
    ('M21 definite reason list emptied', STATE,
     "['age_gate', 'disabled', 'rate_limited', 'reason_changed', 'self_report']", '[]'),
    ('M22 recovered poll keeps error', STATE,
     '    this.reconcileSubmissions(state, collected, append)\n    state.error = null\n',
     '    this.reconcileSubmissions(state, collected, append)\n'),
    # CR6: reproduce request invalidation by an append that performs no network read.
    ('M27 no-cursor append invalidates refresh', STATE,
     '    if (append && !current?.nextCursor) return\n',
     "    if (append && !current?.nextCursor) {\n"
     "      this.ownRequest(postId, `${postId}/${parentId ?? ''}`)\n"
     "      return\n    }\n"),
]

# Analysis for mutants expected to survive: each removes one half of a redundant guard pair,
# so no observable behavior changes while the other half stays.
NOTES = {
    'M5a schedule stopped guard removed': 'Equivalent: stop() unsubscribes schedule and clears the '
    'timer, and the timer and post-poll fences return on stopped, so no path reaches schedule() after stop.',
    'M6 stop does not clear timer': 'Equivalent: the timer callback rechecks stopped before polling (pair of M23e).',
    'M23e timer stopped recheck removed': 'Equivalent: stop() clears the armed timer (pair of M6).',
    'M23a schedule ticket guard removed': 'Equivalent: the renewal block directly above makes valid() '
    'true, and nothing runs between it and the guard, so !valid() is always false there.',
    'M23c timer ticket recheck removed': 'Equivalent by invariant I: the old timer is cancelled at '
    'renewal, and scheduledCycle !== cycle rejects it anyway. The resume test cannot kill it because '
    'two other fences cover the same case.',
    'M24b cycle bump removed': 'Equivalent by invariant I: every cycle check is shadowed by an owns() '
    'check that is false in exactly the same states.',
    'M26a timer cycle recheck removed': 'Equivalent by invariant I (owns() recheck) and the renewal clearTimeout.',
    'M26b post-poll ticket fence removed': 'Equivalent by invariant I: the cycle fence covers it.',
    'M26c post-poll cycle fence removed': 'Equivalent by invariant I: the owns() fence covers it.',
    'M26d post-poll stopped fence removed': 'Equivalent: the follow-up schedule() returns on stopped; '
    'only busy/failures of a dead watch change.',
    'M26e timer uses live ticket': 'Equivalent by invariant I: the live ticket is renewed, so this '
    'removes the owns() recheck, and the cycle recheck covers it (same as M23c).',
}
INVARIANT = 'Invariant I: a ticket only goes invalid in reset() or evict(), both emit synchronously, and the watch listener runs schedule(), whose renewal block cancels the old timer and bumps cycle, before any timer or poll callback can run. Old tickets never become valid again (generation only grows). So, while not stopped, !owns() holds exactly when scheduledCycle !== cycle.'


def sh(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def prepare():
    shutil.rmtree(WORK, ignore_errors=True)
    shutil.copytree(PKG, COPY, symlinks=True,
                    ignore=shutil.ignore_patterns('node_modules', 'dist', 'coverage'))
    # Package-local deps first, then the hoisted workspace deps, as in the repo.
    if os.path.isdir(os.path.join(PKG, 'node_modules')):
        os.symlink(os.path.join(PKG, 'node_modules'), os.path.join(COPY, 'node_modules'))
    os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(WORK, 'node_modules'))
    # The package tsconfig extends ../../tsconfig.json, which vitest resolves at load time.
    shutil.copy(os.path.join(REPO, 'tsconfig.json'), os.path.join(WORK, 'tsconfig.json'))


def run(tag):
    out = os.path.join(WORK, f'result-{tag}.json')
    if os.path.exists(out):
        os.remove(out)
    proc = sh([VITEST, 'run', '--config', 'vitest.config.ts', *SPECS,
               '--reporter=json', f'--outputFile={out}'], COPY)
    if not os.path.exists(out):
        return None, proc.stdout + proc.stderr
    data = json.load(open(out))
    results, broken = {}, []
    for f in data['testResults']:
        if not f['assertionResults'] and f.get('status') == 'failed':
            broken.append(os.path.basename(f['name']))
        for a in f['assertionResults']:
            results[f"{os.path.basename(f['name'])} > {a['fullName']}"] = a['status']
    return (results, broken), ''


def flat(snippet):
    text = snippet.strip('\n').replace('|', '\\|').replace('\n', ' \\n ')
    return re.sub(r' +', ' ', text).strip()


def main():
    if sys.argv[1:] not in ([], ['--only-cr6']):
        sys.exit('Usage: mutation-client.py [--only-cr6]')
    only_cr6 = sys.argv[1:] == ['--only-cr6']
    mutants = [m for m in MUTANTS if m[0].startswith('M27 ')] if only_cr6 else MUTANTS
    evidence_name = 'mutation-client-cr6' if only_cr6 else 'mutation-client'
    prepare()
    sha = {p: hashlib.sha256(open(os.path.join(COPY, p), 'rb').read()).hexdigest()[:12]
           for p in (STATE, CONTRACT)}
    # Mutate the snapshot taken into the copy, even if the repo source moves during the run.
    snapshot = {p: open(os.path.join(COPY, p)).read() for p in (STATE, CONTRACT)}
    base, err = run('baseline')
    if base is None:
        sys.exit('baseline run failed:\n' + err)
    baseline, broken = base
    if not baseline or broken:
        sys.exit(f'baseline did not load: tests={len(baseline)} broken={broken}')
    base_failed = sorted(n for n, s in baseline.items() if s != 'passed')
    if base_failed:
        sys.exit(f'baseline has failing tests: {base_failed}')
    rows = []
    for mid, rel, original, mutated in mutants:
        path = os.path.join(COPY, rel)
        pristine = snapshot[rel]
        count = pristine.count(original)
        if count != 1:
            rows.append(dict(id=mid, where=f'{rel}:?', original=original, mutated=mutated,
                             killers=[], verdict=f'not applied ({count} matches)'))
            continue
        line = pristine[:pristine.index(original)].count('\n') + 1
        line += len(original) - len(original.lstrip('\n'))
        open(path, 'w').write(pristine.replace(original, mutated, 1))
        try:
            res, err = run('mutant')
        finally:
            open(path, 'w').write(pristine)
        if res is None:
            rows.append(dict(id=mid, where=f'{rel}:{line}', original=original, mutated=mutated,
                             killers=['<suite did not run>'], verdict='killed'))
            continue
        results, broken = res
        killers = sorted(n for n, s in results.items()
                         if s != 'passed' and baseline.get(n) == 'passed')
        killers += [f'<{b} failed to load>' for b in broken]
        rows.append(dict(id=mid, where=f'{rel}:{line}', original=original, mutated=mutated,
                         killers=killers, verdict='killed' if killers else 'survived'))
    killed = sum(r['verdict'] == 'killed' for r in rows)
    json.dump(dict(sha=sha, baseline_total=len(baseline), baseline_failed=base_failed,
                   rows=rows), open(os.path.join(HERE, evidence_name + '.json'), 'w'), indent=2)
    md = [
        '# Mutation evidence: Story 6.4 shared comments client',
        '',
        'Script: `' + os.path.join(HERE, 'mutation-client.py') + '`',
        '',
        'Reproduce:',
        '',
        '```sh',
        'python3 -I ' + os.path.join(HERE, 'mutation-client.py') + (' --only-cr6' if only_cr6 else ''),
        '```',
        '',
        'What it runs per mutant, inside the scratch copy `' + COPY + '` '
        '(node_modules symlinked to the package and repo root):',
        '',
        '```sh',
        f'cd {COPY} && {VITEST} run --config vitest.config.ts ' + ' '.join(SPECS)
        + ' --reporter=json --outputFile=<result.json>',
        '```',
        '',
        f'Source under test (sha256 prefix at run time): `{STATE}` {sha[STATE]}, '
        f'`{CONTRACT}` {sha[CONTRACT]}.',
        '',
        f'Baseline on the unmutated copy: {len(baseline)} tests, '
        f'{len(baseline) - len(base_failed)} passed, {len(base_failed)} failed.',
        '',
    ]
    md += [f'- baseline failure: {n}' for n in base_failed]
    md += ['', 'A mutant is killed when at least one test that passes on the baseline fails on '
           'the mutant. Baseline failures are excluded from killing evidence.', '',
           f'Result: {killed} of {len(rows)} mutants killed.', '', INVARIANT, '',
           '| Mutant | file:line | Original | Mutated | Verdict | Killing tests | Notes |',
           '| --- | --- | --- | --- | --- | --- | --- |']
    for r in rows:
        killers = '<br>'.join(k.replace('|', '\\|') for k in r['killers']) or '-'
        md.append(f"| {r['id']} | `{r['where']}` | `{flat(r['original'])}` | "
                  f"`{flat(r['mutated']) or '(deleted)'}` | {r['verdict']} | {killers} | "
                  f"{NOTES.get(r['id'], '-') if r['verdict'] != 'killed' else '-'} |")
    open(os.path.join(HERE, evidence_name + '.md'), 'w').write('\n'.join(md) + '\n')
    print(f'{killed}/{len(rows)} killed')
    for r in rows:
        print(f"{r['verdict']:>10}  {r['id']}  {r['where']}  killers={len(r['killers'])}")


if __name__ == '__main__':
    try:
        main()
    finally:
        shutil.rmtree(WORK, ignore_errors=True)
