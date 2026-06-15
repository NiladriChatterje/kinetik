import struct
import zlib
import os
import sys

def create_png(width, height, r, g, b, filepath):
    """Create a minimal valid PNG with a solid color."""
    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'
    
    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data) & 0xFFFFFFFF
    ihdr_chunk = struct.pack('>I', len(ihdr_data)) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)
    
    # IDAT chunk - raw pixel data
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # filter byte
        for x in range(width):
            raw_data += struct.pack('BBB', r, g, b)
    
    compressed = zlib.compress(raw_data)
    idat_crc = zlib.crc32(b'IDAT' + compressed) & 0xFFFFFFFF
    idat_chunk = struct.pack('>I', len(compressed)) + b'IDAT' + compressed + struct.pack('>I', idat_crc)
    
    # IEND chunk
    iend_crc = zlib.crc32(b'IEND') & 0xFFFFFFFF
    iend_chunk = struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc)
    
    with open(filepath, 'wb') as f:
        f.write(signature + ihdr_chunk + idat_chunk + iend_chunk)

if __name__ == '__main__':
    base = sys.argv[1] if len(sys.argv) > 1 else 'D:/react-projects/kinetik/packages/mobile/src/assets/images'
    os.makedirs(base, exist_ok=True)
    
    print(f"Generating assets in: {base}")
    
    # icon.png - 1024x1024 dark bg
    create_png(1024, 1024, 10, 10, 15, os.path.join(base, 'icon.png'))
    print("  Created icon.png (1024x1024)")
    
    # splash.png - 1242x2436 dark bg
    create_png(1242, 2436, 10, 10, 15, os.path.join(base, 'splash.png'))
    print("  Created splash.png (1242x2436)")
    
    # adaptive-icon.png - 1024x1024 slightly lighter
    create_png(1024, 1024, 30, 30, 40, os.path.join(base, 'adaptive-icon.png'))
    print("  Created adaptive-icon.png (1024x1024)")
    
    print("Done! All placeholder assets created successfully.")
