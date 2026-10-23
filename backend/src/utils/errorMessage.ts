const typeLabels: Record<string, string> = {
  ModelOutputTruncatedError: '模型输出达到单次上限，结果已截断',
  ModelOutputValidationError: '模型提交结果未通过字段、范围或证据校验',
  Error: '操作失败',
  MiddlewareError: '分析中间件执行失败',
  StructuredOutputParsingError: '模型提交的结构化结果不符合格式要求',
  MultipleStructuredOutputsError: '模型一次提交了多个结构化结果',
  ZodError: '字段格式校验失败',
  TypeError: '数据类型或程序调用异常',
  SyntaxError: '数据语法错误，无法解析',
  AbortError: '操作已取消',
  TimeoutError: '请求超时',
  AnalysisLimitError: '分析预算已达上限',
  ContextLimitError: '任务超过模型上下文限制',
  ModelConfigurationError: '模型服务配置错误',
  SessionError: '会话操作失败',
  ValidationMessage: '结构化字段校验未通过',
  UnknownOrCircularError: '没有可展开的错误详情，或原因链存在循环'
}

export function errorTypeLabel(type: string) {
  return typeLabels[type] ?? '执行失败，请查看具体阶段和错误原因'
}

export function schemaIssueMessage(code: string, expected?: unknown) {
  const labels: Record<string, string> = {
    invalid_type: '字段缺失或数据类型不正确',
    invalid_value: '字段值不在允许范围内',
    too_small: '字段长度、数量或数值小于允许下限',
    too_big: '字段长度、数量或数值超过允许上限',
    invalid_format: '字段格式不正确',
    unrecognized_keys: '包含契约未定义的字段',
    invalid_union: '字段不符合任何允许的格式',
    custom: '字段未通过业务规则校验'
  }
  const types: Record<string, string> = {
    string: '字符串',
    number: '数值',
    boolean: '布尔值',
    object: '对象',
    array: '数组',
    null: '空值',
    undefined: '未提供的值'
  }
  return `${labels[code] ?? '字段校验失败'}${typeof expected === 'string' && types[expected] ? `，应为${types[expected]}` : ''}`
}

export function schemaFieldPath(path: unknown) {
  const fields: Record<string, string> = {
    units: '执行单元',
    references: '引用关系',
    unresolvedItems: '未解决问题',
    analyzedRanges: '已分析范围',
    fileId: '文件编号',
    schemaVersion: '格式版本',
    status: '状态',
    summary: '摘要',
    unitId: '执行单元编号',
    name: '名称',
    scope: '作用域',
    kind: '类型',
    range: '源码范围',
    signature: '签名',
    controlRanges: '控制语句范围',
    callSites: '调用点',
    text: '调用源码文本',
    receiver: '调用接收对象',
    evidenceIds: '源码证据编号',
    boundary: '边界',
    complete: '是否完整',
    startKnown: '起点是否确认',
    endKnown: '终点是否确认',
    startOffset: '起始字符偏移',
    endOffset: '结束字符偏移',
    lineStart: '起始行',
    lineEnd: '结束行',
    columnStart: '起始列',
    columnEnd: '结束列',
    nodes: '流程节点',
    edges: '连线',
    localId: '局部编号',
    callSiteIds: '调用点编号',
    entryLocalId: '入口编号',
    emptyReason: '空流程原因',
    selectors: '读取选择器',
    type: '类型',
    chunkId: '源码块编号',
    targetHint: '调用目标线索',
    alias: '别名',
    targetPath: '目标模块路径'
  }
  return Array.isArray(path) && path.length
    ? path
        .map((part) =>
          typeof part === 'number' ? `第${part + 1}项` : (fields[String(part)] ?? '未知字段')
        )
        .join(' → ')
    : '提交结果'
}

/** 翻译常见依赖错误，不向用户回传供应商原始响应、请求参数或源码。 */
export function chineseErrorMessage(
  error: unknown,
  fallback = '操作失败，请稍后重试。',
  preserveBusinessMessage = true
): string {
  const seen = new Set<object>()
  const visit = (value: unknown, depth: number): string | undefined => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 5) return
    seen.add(value)
    const data = value as {
      message?: unknown
      name?: unknown
      status?: unknown
      cause?: unknown
      issues?: unknown
    }
    const message = typeof data.message === 'string' ? data.message : ''
    const type = value instanceof Error ? value.constructor.name : String(data.name ?? '')
    // 项目定义的中文业务提示已经可读；依赖错误只使用固定译文。
    if (
      preserveBusinessMessage &&
      /^[\u4e00-\u9fff]/u.test(message) &&
      (type === 'Error' ||
        /^(Session|AnalysisLimit|ContextLimit|ModelConfiguration|LanguageDetectionConfig|MultiConfiguration|FragmentConflict)Error$/.test(
          type
        ))
    )
      return message
    const cause = visit(data.cause, depth + 1)
    if (cause) return cause
    if (type === 'ZodError' && Array.isArray(data.issues)) {
      const customMessages = new Set([
        '结束行号必须大于或等于起始行号。',
        '同一行内的结束列必须大于或等于起始列。',
        '分支概率分布无效。'
      ])
      return `字段格式校验失败：${data.issues
        .slice(0, 10)
        .map((issue: unknown) => {
          const item = issue && typeof issue === 'object' ? (issue as Record<string, unknown>) : {}
          const explanation =
            typeof item.message === 'string' && customMessages.has(item.message)
              ? item.message
              : schemaIssueMessage(typeof item.code === 'string' ? item.code : '', item.expected)
          return `${schemaFieldPath(item.path)}：${explanation}`
        })
        .join('；')}`
    }
    if (data.status === 401 || data.status === 403)
      return `服务鉴权失败（HTTP ${data.status}），请检查密钥与访问权限。`
    if (data.status === 429) return '服务请求过于频繁或额度不足，请稍后重试。'
    if (typeof data.status === 'number' && data.status >= 500)
      return '上游服务暂时不可用，请稍后重试。'
    if (/timeout|timed out/i.test(message) || type === 'TimeoutError')
      return '请求超时，请稍后重试。'
    if (/abort|cancel/i.test(message) || type === 'AbortError') return '操作已取消。'
    if (/context.*(length|window)|maximum context/i.test(message))
      return '任务超过模型上下文限制，请缩小源码范围。'
    if (/network|fetch failed|ECONN|ENOTFOUND/i.test(message))
      return '网络连接失败，请检查后端及模型服务连接。'
    if (typeLabels[type] && type !== 'Error') return `${typeLabels[type]}。`
  }
  return visit(error, 0) ?? fallback
}
