import { expect, it } from 'vitest'
import { chunkSource } from '../src/utils/sourceChunks'
import { coveredLines } from '../src/utils/sourcePositions'

it('Java 大类按成员切分，并保留超长方法、前置注释和原始行号', async () => {
  const packageLine = 'package demo.tools;'
  const first = [
    '/** 累加器 */',
    'class Accumulator {',
    '  void add() {',
    '    int total = 0;',
    ...Array<string>(25).fill('    total++;'),
    '  }'
  ]
  const second = [
    '  /** 继续累加 */',
    '  void next() {',
    '    int total = 0;',
    ...Array<string>(25).fill('    total++;'),
    '  }',
    '}'
  ]
  const source = [packageLine, ...first, ...second, ''].join('\r\n')
  const chunks = await chunkSource('f', 'Accumulator.java', source, {
    chunkTargetChars: 256
  })

  expect(chunks.map((chunk) => chunk.strategy)).toEqual(['syntax', 'syntax', 'syntax'])
  expect(chunks[0]?.javaScope).toBeUndefined()
  expect(chunks[1]?.javaScope).toEqual({ packageName: 'demo.tools' })
  expect(chunks[2]?.javaScope).toEqual({ packageName: 'demo.tools', enclosingClass: 'Accumulator' })
  expect(chunks.map((chunk) => source.slice(chunk.startOffset, chunk.endOffset))).toEqual([
    `${packageLine}\r\n`,
    [...first, ''].join('\r\n'),
    [...second, ''].join('\r\n')
  ])
  expect(chunks.map(coveredLines)).toEqual([
    { lineStart: 1, lineEnd: 1 },
    { lineStart: 2, lineEnd: first.length + 1 },
    { lineStart: first.length + 2, lineEnd: first.length + second.length + 1 }
  ])
})

it.each(['broken.ts', 'unsupported.txt'])('文件 %s 无法按语法切分时保留整份源码', async (path) => {
  const source = `function unfinished() {\n${'  count++;\n'.repeat(40)}`
  const chunks = await chunkSource('f', path, source, { chunkTargetChars: 256 })

  expect(chunks).toMatchObject([
    { strategy: 'whole-file', startOffset: 0, endOffset: source.length }
  ])
})

it('密集的执行单元和调用在字符目标以内也按语法边界切分', async () => {
  const source = Array.from({ length: 24 }, (_, index) => `function f${index}() { return load() }\n`).join('')
  const chunks = await chunkSource('f', 'dense.js', source, { chunkTargetChars: 6000 })
  const bodies = chunks.map(({ startOffset, endOffset }) => source.slice(startOffset, endOffset))
  expect(bodies.length).toBeGreaterThan(1)
  expect(bodies.join('')).toBe(source)
  for (const body of bodies) {
    expect(body).toMatch(/^function /)
    expect(body).toMatch(/\}\n$/)
  }
})
