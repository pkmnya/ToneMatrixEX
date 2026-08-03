import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pmDir = path.join(__dirname, 'public', 'pm');
const outputFile = path.join(pmDir, 'index.json');

const result = {
  folders: []
};

if (fs.existsSync(pmDir)) {
  const entries = fs.readdirSync(pmDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const folderName = entry.name;
      const folderPath = path.join(pmDir, folderName);
      const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.mp3'));
      
      const folderData = {
        name: folderName,
        sample: null,
        songs: []
      };

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

      result.folders.push(folderData);
    }
  }
}

fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
console.log('Index generated at', outputFile);
