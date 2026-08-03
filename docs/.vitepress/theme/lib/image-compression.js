/**
 * Client-side image compression utility.
 *
 * Compresses images to WebP format before upload to reduce file size.
 * Uses the Canvas API for image processing (supported in all modern browsers).
 *
 * Features:
 * - Automatic resizing (maintains aspect ratio)
 * - WebP conversion with quality adjustment
 * - Iterative compression to meet target file size
 * - Silent operation (no user interaction required)
 */

/**
 * Compress an image file to WebP format
 * @param {File} file - Original image file
 * @param {Object} options - Compression options
 * @param {number} options.maxWidth - Max width in pixels (default: 1920)
 * @param {number} options.maxHeight - Max height in pixels (default: 1080)
 * @param {number} options.targetSizeKB - Target file size in KB (default: 250)
 * @param {number} options.minQuality - Minimum WebP quality 0-1 (default: 0.6)
 * @returns {Promise<File>} Compressed WebP file
 */
export async function compressToWebP(file, options = {}) {
  const {
    maxWidth = 1920,
    maxHeight = 1080,
    targetSizeKB = 250,
    minQuality = 0.6
  } = options;

  // Validate input
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Invalid image file');
  }

  // Load image from file
  const img = await loadImage(file);

  // Calculate new dimensions (maintain aspect ratio)
  const { width, height } = calculateDimensions(img, maxWidth, maxHeight);

  // Draw to canvas and compress
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Enable image smoothing for better quality
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(img, 0, 0, width, height);

  // Clean up object URL
  URL.revokeObjectURL(img.src);

  // Iterative compression to meet target size
  // Start with high quality and reduce if needed
  let quality = 0.92;
  let blob = await canvasToWebP(canvas, quality);

  // Binary search for optimal quality
  // Only compress further if the initial attempt is still too large
  if (blob.size > targetSizeKB * 1024) {
    let low = minQuality;
    let high = quality;

    // Limit iterations to avoid infinite loop
    for (let i = 0; i < 10; i++) {
      quality = (low + high) / 2;
      blob = await canvasToWebP(canvas, quality);

      if (blob.size > targetSizeKB * 1024) {
        high = quality;
      } else {
        low = quality;
        // If we're close enough to target, stop
        if (blob.size > targetSizeKB * 1024 * 0.9) {
          break;
        }
      }

      // Stop if quality is at minimum
      if (quality <= minQuality) {
        break;
      }
    }
  }

  // Return as File object with .webp extension
  const compressedFile = new File(
    [blob],
    changeExtension(file.name, '.webp'),
    {
      type: 'image/webp',
      lastModified: Date.now()
    }
  );

  return compressedFile;
}

/**
 * Load an image from a File object
 * @param {File} file
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Calculate new dimensions to fit within max bounds while maintaining aspect ratio
 * @param {HTMLImageElement} img
 * @param {number} maxWidth
 * @param {number} maxHeight
 * @returns {{ width: number, height: number }}
 */
function calculateDimensions(img, maxWidth, maxHeight) {
  let { width, height } = img;

  // Only resize if image exceeds max dimensions
  if (width > maxWidth || height > maxHeight) {
    const widthRatio = maxWidth / width;
    const heightRatio = maxHeight / height;
    const ratio = Math.min(widthRatio, heightRatio);

    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  return { width, height };
}

/**
 * Convert canvas to WebP blob with given quality
 * @param {HTMLCanvasElement} canvas
 * @param {number} quality - 0 to 1
 * @returns {Promise<Blob>}
 */
function canvasToWebP(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      'image/webp',
      quality
    );
  });
}

/**
 * Change file extension to .webp
 * @param {string} filename
 * @param {string} newExt
 * @returns {string}
 */
function changeExtension(filename, newExt) {
  // Remove existing extension and add .webp
  const base = filename.replace(/\.[^.]+$/, '');
  return base + newExt;
}
