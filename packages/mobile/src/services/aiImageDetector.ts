/**
 * On-device AI-generated image detector.
 *
 * Model: src/assets/models/ai_image_detector.tflite (6.8 MB), a 6M-parameter
 * Perception Encoder classifier (Apache-2.0, see ai_image_detector.NOTICE.md),
 * converted to TFLite with int8 weights. Runs on the CPU with fast-tflite.
 *
 * It is a SECOND line, used only for photos that carry no camera data and no
 * metadata verdict (services/photoOrigin.ts). Measured through this exact
 * pipeline at the 0.9 cut-off: 0 of 51 live profile photos flagged, about a
 * third of modern AI portraits caught. It misses most ChatGPT, Gemini and
 * FLUX.2 images, so it is a filter, not a guarantee.
 *
 * Pipeline (must match what the threshold was measured on):
 *   compressed 1200px WebP → shorter side 256 (bilinear) → centre crop 256
 *   → JPEG 1.0 → jpeg-js → Float32 [1,256,256,3] RGB / 255 → logits [fake, real]
 */

import { Asset } from 'expo-asset';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { decode as decodeJpeg } from 'jpeg-js';

/** p(AI) at or above this refuses the photo */
export const AI_IMAGE_THRESHOLD = 0.9;

const INPUT_SIZE = 256;

let modelPromise: Promise<import('react-native-fast-tflite').TensorflowModel> | null = null;

async function getModel(): Promise<import('react-native-fast-tflite').TensorflowModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      // Lazy, like the face model: NitroModules load only when needed
      const { loadTensorflowModel } = await import('react-native-fast-tflite');
      // A release build has no Metro server: expo-asset copies the raw
      // resource to a cache file so fast-tflite gets a file:// URL
      // (see faceVerification.ts getModel for the full story)
      const [asset] = await Asset.loadAsync(require('../assets/models/ai_image_detector.tflite'));
      if (!asset?.localUri) throw new Error('AI detector asset has no local file');
      return loadTensorflowModel({ url: asset.localUri }, []);
    })().catch((err) => {
      modelPromise = null; // Allow a retry on the next photo
      throw err;
    });
  }
  return modelPromise;
}

/** Shorter side to 256, centre crop 256×256, saved as a JPEG in the cache */
async function cropForModel(imageUri: string, width: number, height: number): Promise<string> {
  const portrait = width <= height;
  const resized = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: portrait ? { width: INPUT_SIZE } : { height: INPUT_SIZE } }],
    { compress: 1.0, format: ImageManipulator.SaveFormat.JPEG },
  );
  const originX = Math.max(0, Math.floor((resized.width - INPUT_SIZE) / 2));
  const originY = Math.max(0, Math.floor((resized.height - INPUT_SIZE) / 2));
  const cropped = await ImageManipulator.manipulateAsync(
    resized.uri,
    [{ crop: { originX, originY, width: INPUT_SIZE, height: INPUT_SIZE } }],
    { compress: 1.0, format: ImageManipulator.SaveFormat.JPEG },
  );
  LegacyFileSystem.deleteAsync(resized.uri, { idempotent: true }).catch(() => {});
  return cropped.uri;
}

async function toTensor(jpegUri: string): Promise<Float32Array> {
  const bytes = await new File(jpegUri).bytes();
  const { data, width, height } = decodeJpeg(bytes, { useTArray: true });
  if (width !== INPUT_SIZE || height !== INPUT_SIZE) {
    throw new Error(`Unexpected crop size ${width}x${height}`);
  }
  const pixels = INPUT_SIZE * INPUT_SIZE;
  const tensor = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    tensor[i * 3] = data[i * 4] / 255;
    tensor[i * 3 + 1] = data[i * 4 + 1] / 255;
    tensor[i * 3 + 2] = data[i * 4 + 2] / 255;
  }
  return tensor;
}

/**
 * Probability (0–1) that the image is AI-generated. Run it on the
 * compressed WebP from compressPhoto (with its width and height), the
 * input the threshold was set on.
 * Throws when the model or the image cannot be processed.
 */
export async function aiImageScore(imageUri: string, width: number, height: number): Promise<number> {
  const model = await getModel();
  const crop = await cropForModel(imageUri, width, height);
  try {
    const input = await toTensor(crop);
    const outputs = await model.run([input.buffer as ArrayBuffer]);
    // Copy before reading: fast-tflite may reuse its output buffer
    const logits = new Float32Array(outputs[0] as ArrayBuffer).slice();
    const [fake, real] = [logits[0], logits[1]];
    const m = Math.max(fake, real);
    const ef = Math.exp(fake - m);
    const er = Math.exp(real - m);
    return ef / (ef + er);
  } finally {
    LegacyFileSystem.deleteAsync(crop, { idempotent: true }).catch(() => {});
  }
}
