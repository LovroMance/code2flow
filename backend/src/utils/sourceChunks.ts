import { dirname, extname, join } from 'node:path'
import { Language, Parser } from '@vscode/tree-sitter-wasm'
import type { CodeChunk } from '../domain/source/schema'
import { lineOffsets, sha256, sourceRange, validateSourceRange } from './sourcePositions'

export type ChunkOptions = { chunkTargetChars: number; allowLineFallback: boolean }
type ChunkStrategy = NonNullable<CodeChunk['strategy']>

const grammars = new Map(Object.entries({
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx',
  '.py': 'python', '.pyw': 'python', '.java': 'java', '.go': 'go',
  '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp', '.hxx': 'cpp',
  '.cs': 'c-sharp', '.rs': 'rust', '.rb': 'ruby', '.php': 'php', '.sh': 'bash', '.bash': 'bash'
}))
const grammarFor = (path: string) => grammars.get(extname(path).toLowerCase())
const languages = new Map<string, Promise<Language>>()
let parserReady: Promise<void> | undefined

function loadGrammar(grammar: string) {
  let language = languages.get(grammar)
  if (!language) {
    const wasmDir = dirname(require.resolve('@vscode/tree-sitter-wasm'))
    parserReady ??= Parser.init({ locateFile: (name) => join(wasmDir, name) })
    language = parserReady.then(() => Language.load(join(wasmDir, `tree-sitter-${grammar}.wasm`)))
    languages.set(grammar, language)
  }
  return language
}

export function chunkerVersion(path: string, options: ChunkOptions) {
  return `syntax-v3-${grammarFor(path) ?? 'none'}-${options.chunkTargetChars}-${options.allowLineFallback ? 'lines' : 'whole'}`
}

/** 只采用完整顶层节点之间的边界。同一行的节点和前置注释保留在同一单元。 */
async function syntaxCuts(grammar: string, text: string, offsets: number[]) {
  const language = await loadGrammar(grammar)
  const parser = new Parser()
  try {
    parser.setLanguage(language)
    // 解析器的行号统一基于 LF。实际分块依然使用原始文本的行偏移。
    const tree = parser.parse(text.replace(/\r\n?/g, '\n'))
    if (!tree) return undefined
    try {
      const root = tree.rootNode
      if (root.hasError) return undefined
      const cuts: number[] = []
      let previousEnd = -1
      let leadingComment: number | undefined
      for (const node of root.namedChildren) {
        if (!node) continue
        const start = node.startPosition.row
        const end = node.endPosition.row - Number(node.endPosition.column === 0)
        if (/comment$/.test(node.type) && start > previousEnd) {
          leadingComment ??= start
          continue
        }
        const row = leadingComment ?? start
        const offset = offsets[row]
        if (previousEnd >= 0 && row > previousEnd && offset !== undefined) cuts.push(offset)
        previousEnd = Math.max(previousEnd, end)
        leadingComment = undefined
      }
      return cuts
    } finally {
      tree.delete()
    }
  } finally {
    parser.delete()
  }
}

/** 当前版本的分块须完整覆盖原文，块之间无重叠且首尾只在行边界或 EOF。 */
export function validateChunks(fileId: string, text: string, chunks: CodeChunk[]) {
  const offsets = lineOffsets(text)
  let covered = 0
  for (const chunk of chunks) {
    validateSourceRange(chunk, fileId, text, offsets)
    if (
      chunk.startOffset !== covered ||
      chunk.columnStart !== 1 ||
      (chunk.endOffset !== text.length && chunk.columnEnd !== 1)
    )
      throw new Error('切块范围存在缺口、重叠或行内边界。')
    covered = chunk.endOffset
  }
  if (covered !== text.length) throw new Error('切块未完整覆盖原始源码。')
}

export async function chunkSource(fileId: string, path: string, text: string, options: ChunkOptions) {
  const offsets = lineOffsets(text)
  const grammar = grammarFor(path)
  const cuts = grammar ? await syntaxCuts(grammar, text, offsets) : undefined
  const strategy: ChunkStrategy = cuts
    ? 'syntax'
    : options.allowLineFallback && text.length > options.chunkTargetChars
      ? 'line-fallback'
      : 'whole-file'
  const boundaries = cuts ?? (strategy === 'line-fallback' ? offsets : [])
  const chunks: Array<CodeChunk & { strategy: ChunkStrategy }> = []
  const contentHash = sha256(text)
  const version = chunkerVersion(path, options)
  let start = 0
  let end = 0
  function pushChunk() {
    chunks.push({
      ...sourceRange(fileId, text, start, end, offsets),
      chunkId: `${fileId}_c${chunks.length}`,
      contentHash,
      chunkerVersion: version,
      strategy
    })
    start = end
  }
  for (const next of [...boundaries, text.length]) {
    if (next - start > options.chunkTargetChars && end > start) pushChunk()
    end = next
  }
  if (end > start) pushChunk()
  validateChunks(fileId, text, chunks)
  return chunks
}
