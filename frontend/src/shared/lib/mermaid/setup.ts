import mermaid from 'mermaid'

let initialized = false

export function ensureMermaid() {
  if (initialized) {
    return mermaid
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'base',
    themeVariables: {
      primaryColor: '#eef3fa',
      primaryTextColor: '#293440',
      primaryBorderColor: '#7d95b5',
      lineColor: '#707c8a',
      secondaryColor: '#edf5f0',
      tertiaryColor: '#fafafa',
      edgeLabelBackground: '#ffffff',
      background: '#ffffff',
      fontSize: '14px',
      fontFamily: 'Aptos, Segoe UI, Microsoft YaHei UI, sans-serif'
    },
    flowchart: {
      useMaxWidth: false,
      htmlLabels: true,
      nodeSpacing: 32,
      rankSpacing: 20,
      padding: 8
    }
  })

  initialized = true
  return mermaid
}
