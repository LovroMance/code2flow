import { defineConfig } from 'vitest/config'

// 自动化测试独立放在 tests，业务源码和正常构建不包含测试文件。
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts']
  }
})
