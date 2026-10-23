// 编辑器选项、导入白名单与扩展名推断共用此表，避免三个入口各自维护。
export const LANGUAGE_OPTIONS = [
  {
    value: 'javascript',
    label: 'JavaScript',
    monaco: 'javascript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs']
  },
  {
    value: 'typescript',
    label: 'TypeScript',
    monaco: 'typescript',
    extensions: ['.ts', '.tsx', '.mts', '.cts']
  },
  { value: 'vue', label: 'Vue', monaco: 'html', extensions: ['.vue'] },
  { value: 'java', label: 'Java', monaco: 'java', extensions: ['.java'] },
  { value: 'c', label: 'C', monaco: 'c', extensions: ['.c', '.h'] },
  {
    value: 'cpp',
    label: 'C++',
    monaco: 'cpp',
    extensions: ['.cpp', '.hpp', '.cc', '.cxx', '.hxx']
  },
  { value: 'python', label: 'Python', monaco: 'python', extensions: ['.py', '.pyw'] },
  { value: 'go', label: 'Go', monaco: 'go', extensions: ['.go'] },
  { value: 'rust', label: 'Rust', monaco: 'rust', extensions: ['.rs'] },
  { value: 'csharp', label: 'C#', monaco: 'csharp', extensions: ['.cs'] },
  { value: 'php', label: 'PHP', monaco: 'php', extensions: ['.php'] },
  { value: 'kotlin', label: 'Kotlin', monaco: 'kotlin', extensions: ['.kt', '.kts'] },
  { value: 'swift', label: 'Swift', monaco: 'swift', extensions: ['.swift'] },
  { value: 'objectivec', label: 'Objective-C', monaco: 'objective-c', extensions: ['.m', '.mm'] },
  { value: 'dart', label: 'Dart', monaco: 'dart', extensions: ['.dart'] },
  { value: 'ruby', label: 'Ruby', monaco: 'ruby', extensions: ['.rb'] },
  { value: 'scala', label: 'Scala', monaco: 'scala', extensions: ['.scala', '.sc'] },
  { value: 'lua', label: 'Lua', monaco: 'lua', extensions: ['.lua'] },
  { value: 'r', label: 'R', monaco: 'r', extensions: ['.r'] },
  { value: 'perl', label: 'Perl', monaco: 'perl', extensions: ['.pl', '.pm'] },
  { value: 'shell', label: 'Shell', monaco: 'shell', extensions: ['.sh', '.bash', '.zsh'] },
  {
    value: 'powershell',
    label: 'PowerShell',
    monaco: 'powershell',
    extensions: ['.ps1', '.psm1', '.psd1']
  },
  { value: 'sql', label: 'SQL', monaco: 'sql', extensions: ['.sql'] },
  { value: 'unknown', label: 'Plain Text', monaco: 'plaintext', extensions: ['.txt'] }
] as const

export type SupportedLanguage = (typeof LANGUAGE_OPTIONS)[number]['value']
export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return LANGUAGE_OPTIONS.some((option) => option.value === value)
}
export const SUPPORTED_FILE_EXTENSIONS = LANGUAGE_OPTIONS.filter(
  (option) => option.value !== 'unknown'
).flatMap((option) => [...option.extensions] as string[])
export const CODE_FILE_ACCEPT = SUPPORTED_FILE_EXTENSIONS.join(',')

export function inferLanguageFromExtension(extension: string): SupportedLanguage {
  return (
    LANGUAGE_OPTIONS.find((option) =>
      (option.extensions as readonly string[]).includes(extension.toLowerCase())
    )?.value ?? 'unknown'
  )
}
