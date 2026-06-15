/**
 * Kinetik - Placeholder Asset Generator
 * Run: node scripts/generate_assets.js
 * 
 * Generates minimal valid PNG files for Expo app assets
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(width, height, r, g, b) {
  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  
  const ihdrType = Buffer.from('IHDR');
  const ihdrCrcData = Buffer.concat([ihdrType, ihdrData]);
  const ihdrCrc = crc32(ihdrCrcData);
  
  const ihdrLength = Buffer.alloc(4);
  ihdrLength.writeUInt32BE(ihdrData.length);
  const ihdrCrcBuf = Buffer.alloc(4);
  ihdrCrcBuf.writeUInt32BE(ihdrCrc);
  
  // IDAT chunk - pixel data
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter byte (none)
    for (let x = 0; x < width; x++) {
      rawData.push(r, g, b);
    }
  }
  
  const compressed = zlib.deflateSync(Buffer.from(rawData));
  const idatType = Buffer.from('IDAT');
  const idatCrcData = Buffer.concat([idatType, compressed]);
  const idatCrc = crc32(idatCrcData);
  
  const idatLength = Buffer.alloc(4);
  idatLength.writeUInt32BE(compressed.length);
  const idatCrcBuf = Buffer.alloc(4);
  idatCrcBuf.writeUInt32BE(idatCrc);
  
  // IEND chunk
  const iendType = Buffer.from('IEND');
  const iendCrc = crc32(iendType);
  const iendLength = Buffer.alloc(4);
  iendLength.writeUInt32BE(0);
  const iendCrcBuf = Buffer.alloc(4);
  iendCrcBuf.writeUInt32BE(iendCrc);
  
  return Buffer.concat([
    signature,
    ihdrLength, ihdrType, ihdrData, ihdrCrcBuf,
    idatLength, idatType, compressed, idatCrcBuf,
    iendLength, iendType, iendCrcBuf,
  ]);
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate assets
const assetsDir = path.join(__dirname, '..', 'packages', 'mobile', 'src', 'assets', 'images');
fs.mkdirSync(assetsDir, { recursive: true });

console.log('Generating placeholder assets...');

// icon.png - 1024x1024 dark background
fs.writeFileSync(path.join(assetsDir, 'icon.png'), createPNG(1024, 1024, 10, 10, 15));
console.log('  ✓ icon.png (1024x1024)');

// splash.png - 1242x2436 dark background
fs.writeFileSync(path.join(assetsDir, 'splash.png'), createPNG(1242, 2436, 10, 10, 15));
console.log('  ✓ splash.png (1242x2436)');

// adaptive-icon.png - 1024x1024
fs.writeFileSync(path.join(assetsDir, 'adaptive-icon.png'), createPNG(1024, 1024, 30, 30, 40));
console.log('  ✓ adaptive-icon.png (1024x1024)');

console.log('\n✅ All placeholder assets generated!');
console.log('   Run "npm install" in the project root to install dependencies.');
