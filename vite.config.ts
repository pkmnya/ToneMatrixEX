import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'

// 自定义插件：自动扫描 public/pm 并生成 index.json
function generatePmIndexPlugin() {
  const generateIndex = () => {
    const pmDir = path.resolve(process.cwd(), 'public/pm');
    const outputFile = path.join(pmDir, 'index.json');
    
    const result = { folders: [] };
    if (fs.existsSync(pmDir)) {
      const entries = fs.readdirSync(pmDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const folderName = entry.name;
          const folderPath = path.join(pmDir, folderName);
          const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.mp3'));
          
          const folderData = { name: folderName, sample: null, songs: [] as {name:string, path:string}[] };
          for (const file of files) {
            if (folderName !== 'common' && file === `${folderName}.mp3`) {
              folderData.sample = `${folderName}/${file}`;
            } else {
              folderData.songs.push({
                name: file.replace('.mp3', ''),
                path: `${folderName}/${file}`
              });
            }
          }
          if (folderData.sample || folderData.songs.length > 0 || folderName === 'common') {
             result.folders.push(folderData);
          }
        }
      }
    }
    
    // 如果没有 pm 目录，创建一个避免报错
    if (!fs.existsSync(pmDir)) {
      fs.mkdirSync(pmDir, { recursive: true });
    }
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  };

  return {
    name: 'generate-pm-index',
    buildStart() {
      generateIndex();
    }
  };
}

// 修改 base 为你的 GitHub 仓库名，例如 '/ToneMatrixEX/'
// 部署到 GitHub Pages 时需要填入正确的仓库名
// 本地开发时保持 '/' 即可
const isGitHubPages = process.env.GITHUB_PAGES === 'true'

export default defineConfig({
  plugins: [generatePmIndexPlugin()],
  base: isGitHubPages ? '/ToneMatrixEX/' : '/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // 代码分块策略，将大库单独打包
        manualChunks(id) {
          if (id.includes('node_modules/tone')) return 'tone';
          if (id.includes('node_modules/lamejs')) return 'lamejs';
        }
      }
    }
  },
  server: {
    port: 5173,
    open: true,  // 启动时自动打开浏览器
  }
})
