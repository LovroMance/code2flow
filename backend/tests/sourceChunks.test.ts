import { expect, it } from 'vitest'
import { chunkSource } from '../src/utils/sourceChunks'
import { coveredLines } from '../src/utils/sourcePositions'

it('Java 大类按成员切分，并保留超长方法、前置注释和原始行号', async () => {
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
  const source = [...first, ...second, ''].join('\r\n')
  const chunks = await chunkSource('f', 'Accumulator.java', source, {
    chunkTargetChars: 256,
    allowLineFallback: false
  })

  expect(chunks.map((chunk) => chunk.strategy)).toEqual(['syntax', 'syntax'])
  expect(chunks.map((chunk) => source.slice(chunk.startOffset, chunk.endOffset))).toEqual([
    [...first, ''].join('\r\n'),
    [...second, ''].join('\r\n')
  ])
  expect(chunks.map(coveredLines)).toEqual([
    { lineStart: 1, lineEnd: first.length },
    { lineStart: first.length + 1, lineEnd: first.length + second.length }
  ])
})
