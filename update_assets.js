const fs = require('fs');
const path = require('path');

const assetDir = path.join(__dirname, 'asset');
const dirs = ['board', 'obstacle', 'tile'];

const assets = {
  boards: [],
  obstacles: [],
  tiles: []
};

dirs.forEach(dir => {
  const fullPath = path.join(assetDir, dir);
  if (!fs.existsSync(fullPath)) return;
  
  const files = fs.readdirSync(fullPath).filter(f => f.toLowerCase().endsWith('.dxf'));
  files.forEach(file => {
    const item = {
      name: path.parse(file).name,
      file: `asset/${dir}/${file}`
    };
    if (dir === 'board') assets.boards.push(item);
    else if (dir === 'obstacle') assets.obstacles.push(item);
    else if (dir === 'tile') assets.tiles.push(item);
  });
});

fs.writeFileSync(path.join(assetDir, 'assets.json'), JSON.stringify(assets, null, 2));
console.log('Successfully generated asset/assets.json');
