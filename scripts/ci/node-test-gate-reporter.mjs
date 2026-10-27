// node:test reporter for node-test-gate.mjs: one JSON line per settled test or suite.
export default async function* nodeTestGateReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue
    const { name, file, entryFile, skip, todo, details } = event.data
    yield `${JSON.stringify({
      outcome: event.type === 'test:pass' ? 'pass' : 'fail',
      kind: details?.type ?? 'test',
      name,
      file,
      // Child-process test events carry entryFile; the runner's per-file wrapper
      // event does not, so an empty file cannot count as its own test.
      entryFile: entryFile ?? null,
      skip: skip !== undefined && skip !== false,
      todo: todo !== undefined && todo !== false,
    })}\n`
  }
}
