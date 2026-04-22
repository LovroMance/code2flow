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
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true
    }
  })

  initialized = true
  return mermaid
}
