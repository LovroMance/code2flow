import { loader } from '@guolao/vue-monaco-editor'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

const getWorker: NonNullable<typeof window.MonacoEnvironment>['getWorker'] = (_, label) => {
  if (label === 'json') {
    return new jsonWorker()
  }

  if (label === 'css' || label === 'scss' || label === 'less') {
    return new cssWorker()
  }

  if (label === 'html' || label === 'handlebars' || label === 'razor') {
    return new htmlWorker()
  }

  if (label === 'typescript' || label === 'javascript') {
    return new tsWorker()
  }

  return new editorWorker()
}

window.MonacoEnvironment = { getWorker }

// 雾白工作台的颜色只作用于展示，不改变诊断、语言服务或节点定位。
monaco.editor.defineTheme('code2flow-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '407D61' },
    { token: 'keyword', foreground: '7336FF' },
    { token: 'string', foreground: 'D32F2F' }
  ],
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#252B35',
    'editorLineNumber.foreground': '#A2ABBA',
    'editorLineNumber.activeForeground': '#778394',
    'editor.lineHighlightBorder': '#FFFFFF',
    'editor.selectionBackground': '#E5EFFD',
    'editorIndentGuide.background1': '#FFFFFF',
    'editorIndentGuide.activeBackground1': '#E2E5E9'
  }
})

loader.config({ monaco })
