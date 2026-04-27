import { z } from 'zod'
import { SupportedLanguageSchema, type SupportedLanguage } from '../../domain/flow/language'

export const DETECT_LANGUAGE_TOOL_NAME = 'detect_language'

export const DetectLanguageToolSchema = z.object({})

export const DetectLanguageResultSchema = z.object({
  language: SupportedLanguageSchema,
  confidence: z.number().min(0).max(1)
})

export const detectLanguageTool = {
  name: DETECT_LANGUAGE_TOOL_NAME,
  description:
    'Detect the programming language of the provided code before generating any flow result.',
  schema: DetectLanguageToolSchema
}

export function runDetectLanguage(code: string) {
  const normalized = code.replace(/\r\n/g, '\n')
  const candidates = [
    scoreVue(normalized),
    scoreTypeScript(normalized),
    scoreJava(normalized),
    scoreCpp(normalized),
    scoreC(normalized),
    scorePython(normalized),
    scoreGo(normalized),
    scoreRust(normalized),
    scoreCSharp(normalized),
    scorePhp(normalized),
    scoreJavaScript(normalized)
  ].sort((left, right) => right.score - left.score)

  const best = candidates[0]

  if (!best || best.score <= 0) {
    return DetectLanguageResultSchema.parse({
      language: 'unknown',
      confidence: 0.2
    })
  }

  return DetectLanguageResultSchema.parse({
    language: best.language,
    confidence: Math.min(1, Number((best.score / 10).toFixed(2)))
  })
}

function scoreVue(code: string) {
  return scoreLanguage('vue', code, [
    /<template[\s>]/i,
    /<script\s+setup/i,
    /<script[^>]*lang=["']ts["']/i,
    /from\s+['"]vue['"]/,
    /\bdefineProps\s*\(/,
    /\bdefineEmits\s*\(/
  ])
}

function scoreTypeScript(code: string) {
  return scoreLanguage('typescript', code, [
    /\binterface\s+[A-Z_a-z]\w*/,
    /\btype\s+[A-Z_a-z]\w*\s*=/,
    /:\s*(string|number|boolean|void|unknown|never|any|Record<|Promise<)/,
    /\bimplements\s+[A-Z_a-z]\w*/,
    /\bimport\s+type\b/,
    /\bas\s+const\b/
  ])
}

function scoreJavaScript(code: string) {
  return scoreLanguage('javascript', code, [
    /\bfunction\s+[A-Z_a-z]\w*\s*\(/,
    /\b(const|let|var)\s+[A-Z_a-z_$][\w$]*\s*=/,
    /=>\s*{/,
    /\bmodule\.exports\b/,
    /\bexport\s+default\b/,
    /\bconsole\.log\s*\(/
  ])
}

function scoreJava(code: string) {
  return scoreLanguage('java', code, [
    /\bpublic\s+class\s+[A-Z_a-z]\w*/,
    /\bpackage\s+[\w.]+;/,
    /\bpublic\s+static\s+void\s+main\s*\(/,
    /\bSystem\.out\.println\s*\(/,
    /\bimport\s+java\./
  ])
}

function scoreCpp(code: string) {
  return scoreLanguage('cpp', code, [
    /#include\s*<iostream>/,
    /\bstd::/,
    /\busing\s+namespace\s+std\s*;/,
    /\bcout\s*<</,
    /\bclass\s+[A-Z_a-z]\w*\s*{/,
    /\btemplate\s*</
  ])
}

function scoreC(code: string) {
  return scoreLanguage('c', code, [
    /#include\s*<stdio\.h>/,
    /\bprintf\s*\(/,
    /\bscanf\s*\(/,
    /\bint\s+main\s*\(/,
    /\bmalloc\s*\(/
  ])
}

function scorePython(code: string) {
  return scoreLanguage('python', code, [
    /^\s*def\s+[A-Z_a-z]\w*\s*\(/m,
    /^\s*class\s+[A-Z_a-z]\w*\s*[:(]/m,
    /^\s*import\s+[A-Z_a-z_][\w.]*/m,
    /^\s*from\s+[A-Z_a-z_][\w.]*\s+import\s+/m,
    /if\s+__name__\s*==\s*['"]__main__['"]/
  ])
}

function scoreGo(code: string) {
  return scoreLanguage('go', code, [
    /^\s*package\s+\w+/m,
    /^\s*func\s+[A-Z_a-z]\w*\s*\(/m,
    /fmt\.Print/,
    /^\s*import\s+\(/m,
    /\bgo\s+[A-Z_a-z]\w*\(/
  ])
}

function scoreRust(code: string) {
  return scoreLanguage('rust', code, [
    /^\s*fn\s+main\s*\(/m,
    /\blet\s+mut\s+/,
    /\bprintln!\s*\(/,
    /\bimpl\s+[A-Z_a-z]\w*/,
    /\buse\s+std::/
  ])
}

function scoreCSharp(code: string) {
  return scoreLanguage('csharp', code, [
    /\busing\s+System\s*;/,
    /\bnamespace\s+[A-Z_a-z]\w*/,
    /\bConsole\.WriteLine\s*\(/,
    /\bpublic\s+class\s+[A-Z_a-z]\w*/,
    /\bstatic\s+void\s+Main\s*\(/
  ])
}

function scorePhp(code: string) {
  return scoreLanguage('php', code, [
    /<\?php/,
    /\becho\s+/,
    /\$\w+\s*=/,
    /\bfunction\s+[A-Z_a-z]\w*\s*\(/,
    /\bnamespace\s+[A-Z_a-z\\]\w*/
  ])
}

function scoreLanguage(language: SupportedLanguage, code: string, patterns: RegExp[]) {
  const score = patterns.reduce((total, pattern) => total + (pattern.test(code) ? 2 : 0), 0)

  return {
    language,
    score
  }
}
