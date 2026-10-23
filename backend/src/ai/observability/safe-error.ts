import {
  chineseErrorMessage,
  errorTypeLabel,
  schemaIssueMessage,
  schemaFieldPath
} from '../../utils/errorMessage'

/** 只提取错误结构并附中文说明，禁止记录异常原文、工具参数或模型正文。 */
export function safeErrorDetails(error: unknown) {
  const fields = new Set([
    'units',
    'references',
    'unresolvedItems',
    'analyzedRanges',
    'fileId',
    'schemaVersion',
    'status',
    'summary',
    'unitId',
    'name',
    'scope',
    'kind',
    'range',
    'signature',
    'controlRanges',
    'callSites',
    'text',
    'receiver',
    'evidenceIds',
    'boundary',
    'complete',
    'startKnown',
    'endKnown',
    'startOffset',
    'endOffset',
    'lineStart',
    'lineEnd',
    'columnStart',
    'columnEnd',
    'nodes',
    'edges',
    'localId',
    'callSiteIds',
    'entryLocalId',
    'emptyReason',
    'selectors',
    'type',
    'chunkId',
    'targetHint',
    'alias',
    'targetPath'
  ])
  const seen = new Set<object>()
  const visit = (value: unknown, depth: number): Record<string, unknown> => {
    // LangChain StructuredOutputParsingError.errors 是字符串数组，不能当成 Error 展开。
    if (typeof value === 'string')
      return {
        type: 'ValidationMessage',
        message: '结构化字段校验未通过，请检查缺失字段、字段类型或允许取值。',
        categories: [
          ...(/required|missing/i.test(value) ? ['missing_field'] : []),
          ...(/additional|unevaluated/i.test(value) ? ['unexpected_field'] : []),
          ...(/type|expected|must be/i.test(value) ? ['type_mismatch'] : []),
          ...(/enum|const|allowed/i.test(value) ? ['invalid_value'] : [])
        ]
      }
    if (!value || typeof value !== 'object' || depth > 5 || seen.has(value))
      return { type: 'UnknownOrCircularError', message: errorTypeLabel('UnknownOrCircularError') }
    seen.add(value)
    const data = value as Record<string, unknown>
    const name = value instanceof Error ? value.constructor.name : data.name
    const message = typeof data.message === 'string' ? data.message : ''
    // 仅输出固定类别；供应商错误原文可能嵌有源码、密钥或完整请求。
    const categories = [
      ['schema_validation', /schema|validation|zod|structured.?output|structured.?response/i],
      ['tool_execution', /tool|工具/iu],
      ['call_limit', /call.?limit|maximum.*calls|model.*limit/i],
      ['context_limit', /context.*length|context.*window|上下文/u],
      ['cancelled', /abort|cancel|timeout/i]
    ] as const
    const frames =
      value instanceof Error
        ? (value.stack ?? '')
            .split('\n')
            .filter((line) => /^\s+at /.test(line))
            .flatMap((line) => {
              // 仅保留依赖/后端文件名和行列，不保留函数参数、绝对路径或错误首行。
              const match = line.match(/[/\\]([\w.-]+\.(?:[cm]?js|ts)):(\d+):(\d+)\)?$/)
              return match ? [`${match[1]}:${match[2]}:${match[3]}`] : []
            })
            .slice(0, 8)
        : []
    return {
      type: typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]*Error$/.test(name) ? name : 'Error',
      typeLabel: errorTypeLabel(typeof name === 'string' ? name : 'Error'),
      message: chineseErrorMessage(value, '操作失败，请查看错误类型、阶段和字段说明。', false),
      ...(typeof data.status === 'number' ? { status: data.status } : {}),
      categories: categories
        .filter(([, pattern]) => pattern.test(message))
        .map(([category]) => category),
      frames,
      ...(typeof data.expected === 'string' &&
      ['string', 'number', 'boolean', 'object', 'array', 'null', 'undefined'].includes(
        data.expected
      )
        ? { expected: data.expected }
        : {}),
      ...(Array.isArray(data.issues)
        ? {
            issues: data.issues.slice(0, 20).map((issue: unknown) => {
              const item =
                issue && typeof issue === 'object' ? (issue as Record<string, unknown>) : {}
              return {
                pathLabel: schemaFieldPath(item.path),
                // 仅保留已知契约字段名，禁止输出模型自行提供的任意属性名。
                path: Array.isArray(item.path)
                  ? item.path.map((part) =>
                      typeof part === 'number' || (typeof part === 'string' && fields.has(part))
                        ? part
                        : '*'
                    )
                  : [],
                code:
                  typeof item.code === 'string' && /^\w{1,40}$/.test(item.code)
                    ? item.code
                    : 'unknown',
                message: schemaIssueMessage(
                  typeof item.code === 'string' ? item.code : '',
                  item.expected
                ),
                ...(typeof item.expected === 'string' &&
                ['string', 'number', 'boolean', 'object', 'array'].includes(item.expected)
                  ? { expected: item.expected }
                  : {})
              }
            })
          }
        : {}),
      ...(data.cause ? { cause: visit(data.cause, depth + 1) } : {}),
      ...(Array.isArray(data.errors)
        ? { errors: data.errors.slice(0, 4).map((item) => visit(item, depth + 1)) }
        : {})
    }
  }
  return visit(error, 0)
}
