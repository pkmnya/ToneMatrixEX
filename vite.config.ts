import { defineConfig } from 'vite'

// 修改 base 为你的 GitHub 仓库名，例如 '/ToneMatrixEX/'
// 部署到 GitHub Pages 时需要填入正确的仓库名
// 本地开发时保持 '/' 即可
const isGitHubPages = process.env.GITHUB_PAGES === 'true'

export default defineConfig({
  base: isGitHubPages ? '/ToneMatrixEX/' : '/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // 代码分块策略，将大库单独打包
        manualChunks: {
          tone: ['tone'],
          lamejs: ['lamejs'],
        }
      }
    }
  },
  server: {
    port: 5173,
    open: true,  // 启动时自动打开浏览器
  }
})
