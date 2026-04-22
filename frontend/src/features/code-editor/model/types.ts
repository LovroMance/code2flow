import type { NodeMapping } from '../../../entities/flow/model/types'

export interface CodeEditorExpose {
  focusMapping: (mapping: NodeMapping) => void
}
