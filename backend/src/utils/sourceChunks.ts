import { dirname, extname, join } from 'node:path'
import { Language, Parser, type Node } from '@vscode/tree-sitter-wasm'
import type { CodeChunk } from '../domain/source/schema'
import { lineOffsets, sha256, sourceRange, validateSourceRange } from './sourcePositions'

export type ChunkOptions = { chunkTargetChars: number }
type ChunkStrategy = 'syntax' | 'whole-file'

// 同轮返回索引与流程图时，一个单元或控制点会产生多条记录。此估算只用于选切点。
const targetFlowItems = 64
const flowUnit = /(?:^|_)(?:function|method|constructor|lambda)(?:_|$)/
const flowItem = /(?:^|_)(?:declaration|if|else|switch|case|match|for|while|loop|try|catch|except|throw|return|call|invocation|command)(?:_|$)/

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
  const grammar = grammarFor(path)
  return `syntax-v6-${grammar ?? 'none'}-${options.chunkTargetChars}-whole`
}

async function inspectSyntax<T>(grammar: string, text: string, inspect: (root: Node) => T) {
  const language = await loadGrammar(grammar)
  const parser = new Parser()
  try {
    parser.setLanguage(language)
    // 解析器的行号统一基于 LF。实际分块依然使用原始文本的行偏移。
    const tree = parser.parse(text.replace(/\r\n?/g, '\n'))
    if (!tree) return undefined
    try {
      return tree.rootNode.hasError ? undefined : inspect(tree.rootNode)
    } finally {
      tree.delete()
    }
  } finally {
    parser.delete()
  }
}

function flowItemsBefore(root: Node, offsets: number[], end: number) {
  const itemsByLine = offsets.map(() => 0)
  const pending = [root]
  while (pending.length) {
    const node = pending.pop()!
    const row = node.startPosition.row
    itemsByLine[row] += flowUnit.test(node.type) ? 3 : Number(flowItem.test(node.type))
    for (const child of node.namedChildren) if (child) pending.push(child)
  }
  const itemsByOffset = new Map<number, number>()
  let count = 0
  offsets.forEach((offset, row) => {
    itemsByOffset.set(offset, count)
    count += itemsByLine[row]!
  })
  itemsByOffset.set(end, count)
  return (start: number, end: number) => itemsByOffset.get(end)! - itemsByOffset.get(start)!
}

/** 优先使用顶层边界。过大的 Java 类还可沿成员边界切分，保留同一行的节点和前置注释。 */
function syntaxCuts(grammar: string, text: string, offsets: number[], targetChars: number) {
  return inspectSyntax(grammar, text, (root) => {
    const cuts: number[] = []
    const flowItems = flowItemsBefore(root, offsets, text.length)
    const enclosingClasses = new Map<number, string>()
    const packageDeclaration = grammar === 'java'
      ? root.namedChildren.find((node) => node?.type === 'package_declaration')
      : undefined
    const packageName = packageDeclaration?.namedChildren.find(
      (node) => node?.type === 'identifier' || node?.type === 'scoped_identifier'
    )?.text.replace(/\s/g, '')
    const packageEnd = packageDeclaration ? offsets[packageDeclaration.endPosition.row + 1] ?? text.length : 0
    function collectCuts(parent: Node, enclosingClass?: string) {
      let previousEnd = -1
      let leadingComment: number | undefined
      for (const node of parent.namedChildren) {
        if (!node) continue
        const start = node.startPosition.row
        const end = node.endPosition.row - Number(node.endPosition.column === 0)
        if (/comment$/.test(node.type) && start > previousEnd) {
          leadingComment ??= start
          continue
        }
        const row = leadingComment ?? start
        const offset = offsets[row]!
        if (previousEnd >= 0 && row > previousEnd) {
          cuts.push(offset)
          if (enclosingClass) enclosingClasses.set(offset, enclosingClass)
        }
        if (
          grammar === 'java' &&
          node.type === 'class_declaration' &&
          ((offsets[end + 1] ?? text.length) - offset > targetChars ||
            flowItems(offset, offsets[end + 1] ?? text.length) > targetFlowItems)
        ) {
          const body = node.childForFieldName('body')
          const name = node.childForFieldName('name')?.text
          if (body && name) collectCuts(body, enclosingClass ? `${enclosingClass}.${name}` : name)
        }
        previousEnd = Math.max(previousEnd, end)
        leadingComment = undefined
      }
    }
    collectCuts(root)
    return { cuts, enclosingClasses, packageName, packageEnd, flowItems }
  })
}

const importNodes: Record<string, string[]> = {
  javascript: ['import_statement'],
  typescript: ['import_statement'],
  tsx: ['import_statement'],
  python: ['import_statement', 'import_from_statement'],
  go: ['import_declaration'],
  java: ['import_declaration'],
  'c-sharp': ['using_directive'],
  rust: ['use_declaration'],
  cpp: ['preproc_include']
}

/** 使用声明的精确原文范围，避免同一行上的另一条导入充当证据。 */
export async function importDeclarationRanges(path: string, text: string) {
  const grammar = grammarFor(path)
  const nodes = grammar && importNodes[grammar]
  if (!grammar || !nodes) return []
  const offsets = lineOffsets(text)
  return (await inspectSyntax(grammar, text, (root) =>
    root.descendantsOfType(nodes).filter((node) => node !== null).map((node) => {
      const start = node.startPosition
      const end = node.endPosition
      const source = node.childForFieldName('source')
      return {
        startOffset: offsets[start.row]! + start.column,
        endOffset: offsets[end.row]! + end.column,
        targetPath: source?.type === 'string' ? source.text.slice(1, -1) : undefined
      }
    })
  )) ?? []
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
  const syntax = grammar ? await syntaxCuts(grammar, text, offsets, options.chunkTargetChars) : undefined
  const strategy: ChunkStrategy = syntax ? 'syntax' : 'whole-file'
  const chunks: Array<CodeChunk & { strategy: ChunkStrategy }> = []
  const contentHash = sha256(text)
  const version = chunkerVersion(path, options)
  let start = 0
  let end = 0
  function pushChunk() {
    const packageName = syntax && start >= syntax.packageEnd ? syntax.packageName : undefined
    const enclosingClass = syntax?.enclosingClasses.get(start)
    chunks.push({
      ...sourceRange(fileId, text, start, end, offsets),
      chunkId: `${fileId}_c${chunks.length}`,
      contentHash,
      chunkerVersion: version,
      strategy,
      ...(packageName || enclosingClass ? { javaScope: { packageName, enclosingClass } } : {})
    })
    start = end
  }
  for (const next of [...(syntax?.cuts ?? []), text.length]) {
    if (
      end > start &&
      (next - start > options.chunkTargetChars || (syntax?.flowItems(start, next) ?? 0) > targetFlowItems)
    ) pushChunk()
    end = next
  }
  if (end > start) pushChunk()
  validateChunks(fileId, text, chunks)
  return chunks
}
