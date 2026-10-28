// node:test reporter for node-test-gate.mjs: one JSON line per settled test or suite.
// It keeps only fields every supported Node 24 release reports; entryFile, for one,
// is absent before 24.22.
export default async function* nodeTestGateReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue
    const { name, nesting, file, skip, todo, details } = event.data
    yield `${JSON.stringify({
      outcome: event.type === 'test:pass' ? 'pass' : 'fail',
      kind: details?.type ?? 'test',
      name,
      nesting,
      file,
      skip: skip !== undefined && skip !== false,
      todo: todo !== undefined && todo !== false,
    })}\n`
  }
}
