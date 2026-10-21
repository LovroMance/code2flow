import mermaid from 'mermaid'

let initialized = false

export function ensureMermaid() {
  if (initialized) {
    return mermaid
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'dark',
    themeVariables: {
      fontSize: '16px',
      fontFamily: 'Aptos, Segoe UI, Microsoft YaHei UI, sans-serif'
    },
    flowchart: {
      useMaxWidth: false,
      htmlLabels: true,
      nodeSpacing: 32,
      rankSpacing: 42,
      padding: 14
    }
  })

  initialized = true
  return mermaid
}
