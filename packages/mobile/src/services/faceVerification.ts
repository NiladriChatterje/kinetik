/**
 * On-Device Face Verification
 *
 * Verifies that a selfie shows the same person as the user's profile photos —
 * entirely on the device, no server round-trip. The result is self-reported
 * to the backend (the verified badge is a UX signal, not a security guarantee).
 *
 * Pipeline per image:
 *   1. ML Kit face detection on the image file (frame + head Euler angles)
 *   2. Crop the largest face (box expanded 25%) and resize to 112×112 JPEG
 *   3. Decode JPEG → RGB float tensor, normalized (px − 127.5) / 127.5
 *   4. MobileFaceNet TFLite → 192-d embedding, L2-normalized
 *
 * Match: cosine similarity between the selfie embedding and each profile
 * photo embedding. confidence = 0.7·best + 0.3·avg, threshold 0.55, and at
 * least 2 profile photos must contain a detectable face — same rules the
 * old server-side face service enforced.
 *
 * This is an identity match only: it answers "is this the same person as the
 * uploaded photos?". It is NOT a liveness or anti-spoofing check — a printed
 * photo of the right person passes.
 */

import FaceDetection, { Face } from '@react-native-ml-kit/face-detection';
import { Asset } from 'expo-asset';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { decode as decodeJpeg } from 'jpeg-js';

// Lazy-loaded so NitroModules isn't pulled in at bundle start (fixes Expo Go crash)
let fastTflite: typeof import('react-native-fast-tflite') | null = null;
async function getFastTflite() {
  if (!fastTflite) {
    fastTflite = await import('react-native-fast-tflite');
  }
  return fastTflite;
}

// ─── Tunables (parity with the retired server-side face service) ─
// The two head-angle limits are an image-quality guard, not a pose challenge:
// a face turned far from the camera yields an unreliable embedding, so the
// selfie is rejected as unusable rather than judged as a mismatch.
const MAX_HEAD_YAW_DEG = 30; // |rotationY| — left/right turn
const MAX_HEAD_PITCH_DEG = 25; // |rotationX| — up/down nod
const MIN_MATCH_THRESHOLD = 0.55; // cosine similarity on MobileFaceNet embeddings
export const MIN_PROFILE_FACES = 2; // profile photos that must contain a face
const MODEL_INPUT_SIZE = 112; // MobileFaceNet input is 112×112×3
const FACE_CROP_EXPANSION = 0.25; // grow the detection box to include full face

export interface FaceVerificationResult {
  verified: boolean;
  confidence: number;
  scores: number[];
  faceDetectedInSelfie: boolean;
  profileFacesDetected: number;
  rejectionReasons: string[];
}

// ─── Model loading (lazy singleton) ──────────────────────────────

let modelPromise: Promise<import('react-native-fast-tflite').TensorflowModel> | null = null;

async function getModel(): Promise<import('react-native-fast-tflite').TensorflowModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const { loadTensorflowModel } = await getFastTflite();
      // fast-tflite reads the model with java.net.URL, which needs a real URL.
      // A release build has no Metro server: require() resolves to a bare
      // res/raw resource name (src_assets_models_mobile_face_net) and URL()
      // throws MalformedURLException; only dev builds get an http URL.
      // expo-asset copies the resource (or downloads it, in dev) to a cache
      // file, so the model always loads from a file:// URL.
      const [asset] = await Asset.loadAsync(require('../assets/models/mobile_face_net.tflite'));
      if (!asset?.localUri) throw new Error('Face model asset has no local file');
      return loadTensorflowModel(
        { url: asset.localUri },
        [], // CPU — a single 112×112 inference is a few ms; delegates not worth the setup
      );
    })().catch((err) => {
      modelPromise = null; // Allow retry on next call
      throw err;
    });
  }
  return modelPromise;
}

// ─── Embedding extraction ────────────────────────────────────────

/**
 * Detect the largest face in the image and return it (or null).
 * Also reports how many faces were found.
 */
async function detectFace(imageUri: string): Promise<{ face: Face | null; count: number }> {
  const faces = await FaceDetection.detect(imageUri, { performanceMode: 'accurate' });
  if (!faces.length) return { face: null, count: 0 };

  const largest = faces.reduce((a, b) =>
    a.frame.width * a.frame.height >= b.frame.width * b.frame.height ? a : b,
  );
  return { face: largest, count: faces.length };
}

/**
 * Crop the face region (expanded box) and resize to the model input size.
 * Returns the URI of a 112×112 JPEG in the cache directory.
 */
async function cropFace(imageUri: string, face: Face): Promise<string> {
  const { left, top, width, height } = face.frame;

  const padX = width * FACE_CROP_EXPANSION;
  const padY = height * FACE_CROP_EXPANSION;
  const originX = Math.max(0, Math.round(left - padX));
  const originY = Math.max(0, Math.round(top - padY));

  // ImageManipulator clamps nothing — probe the image dimensions first so the
  // crop rect never exceeds the bitmap.
  const probe = await ImageManipulator.manipulateAsync(imageUri, [], { base64: false });
  const cropW = Math.min(Math.round(width + padX * 2), probe.width - originX);
  const cropH = Math.min(Math.round(height + padY * 2), probe.height - originY);

  const result = await ImageManipulator.manipulateAsync(
    imageUri,
    [
      { crop: { originX, originY, width: cropW, height: cropH } },
      { resize: { width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE } },
    ],
    { compress: 1.0, format: ImageManipulator.SaveFormat.JPEG },
  );
  return result.uri;
}

/**
 * Read a 112×112 JPEG and convert it to the model's input tensor:
 * Float32Array[1·112·112·3], RGB, normalized (px − 127.5) / 127.5.
 */
async function jpegToTensor(jpegUri: string): Promise<Float32Array> {
  const bytes = await new File(jpegUri).bytes();
  const { data, width, height } = decodeJpeg(bytes, { useTArray: true });

  if (width !== MODEL_INPUT_SIZE || height !== MODEL_INPUT_SIZE) {
    throw new Error(`Unexpected crop size ${width}x${height}`);
  }

  const pixels = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  const tensor = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    tensor[i * 3] = (data[i * 4] - 127.5) / 127.5; // R
    tensor[i * 3 + 1] = (data[i * 4 + 1] - 127.5) / 127.5; // G
    tensor[i * 3 + 2] = (data[i * 4 + 2] - 127.5) / 127.5; // B (alpha skipped)
  }
  return tensor;
}

/**
 * Full pipeline: image URI → L2-normalized 192-d face embedding.
 * Returns null when no face is detected. Also reports the face count
 * so callers can reject multi-face selfies.
 */
export async function embedFace(
  imageUri: string,
): Promise<{ embedding: Float32Array | null; face: Face | null; faceCount: number }> {
  const { face, count } = await detectFace(imageUri);
  if (!face) return { embedding: null, face: null, faceCount: 0 };

  const cropUri = await cropFace(imageUri, face);
  try {
    const tensor = await jpegToTensor(cropUri);
    const model = await getModel();

    // fast-tflite v3 takes/returns ArrayBuffers (tensor was allocated via
    // `new Float32Array(n)`, so its buffer is a plain ArrayBuffer)
    const outputs = await model.run([tensor.buffer as ArrayBuffer]);
    // Copy, don't wrap: fast-tflite reuses one output ArrayBuffer for every
    // run, so a view would be overwritten by the next embedFace() call —
    // every profile embedding would become the selfie's and match at 1.0.
    const embedding = new Float32Array(outputs[0] as ArrayBuffer).slice();

    // L2-normalize so cosine similarity is a plain dot product
    let norm = 0;
    for (let i = 0; i < embedding.length; i++) norm += embedding[i] * embedding[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < embedding.length; i++) embedding[i] /= norm;

    return { embedding, face, faceCount: count };
  } finally {
    // The 112×112 crop is a throwaway temp file
    try {
      new File(cropUri).delete();
    } catch {
      // Non-critical — cache cleanup
    }
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(0, Math.min(1, dot));
}

// ─── Profile photo embeddings ────────────────────────────────────

/**
 * Download each profile photo (absolute URL) to the cache and compute its
 * face embedding. Photos without a detectable face are skipped.
 */
export async function embedProfilePhotos(photoUrls: string[]): Promise<Float32Array[]> {
  const embeddings: Float32Array[] = [];

  for (let i = 0; i < photoUrls.length; i++) {
    // Profile photos are stored as WebP (see services/photoService.ts)
    const localPath = `${LegacyFileSystem.cacheDirectory}face-verify-profile-${i}.webp`;
    try {
      await LegacyFileSystem.downloadAsync(photoUrls[i], localPath);
      const { embedding } = await embedFace(localPath);
      if (embedding) embeddings.push(embedding);
    } catch (err) {
      console.warn('[faceVerification] Skipping profile photo:', err);
    } finally {
      LegacyFileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
    }
  }

  return embeddings;
}

// ─── Verification ────────────────────────────────────────────────

/**
 * Verify a selfie against precomputed profile photo embeddings.
 * `minProfileFaces` is how many of those photos must contain a face:
 * onboarding checks the whole set, a new primary photo is checked alone.
 */
export async function verifySelfie(
  selfieUri: string,
  profileEmbeddings: Float32Array[],
  minProfileFaces = MIN_PROFILE_FACES,
): Promise<FaceVerificationResult> {
  const rejectionReasons: string[] = [];

  const { embedding, face, faceCount } = await embedFace(selfieUri);

  if (!embedding || !face) {
    return {
      verified: false,
      confidence: 0,
      scores: [],
      faceDetectedInSelfie: false,
      profileFacesDetected: profileEmbeddings.length,
      rejectionReasons: ['No face detected'],
    };
  }

  if (faceCount > 1) {
    rejectionReasons.push(`More than one face in frame (${faceCount})`);
  }
  if (Math.abs(face.rotationY) > MAX_HEAD_YAW_DEG) {
    rejectionReasons.push(`Head turned too far (${face.rotationY.toFixed(0)}°)`);
  }
  if (Math.abs(face.rotationX) > MAX_HEAD_PITCH_DEG) {
    rejectionReasons.push(`Head tilted too far (${face.rotationX.toFixed(0)}°)`);
  }
  if (profileEmbeddings.length < minProfileFaces) {
    rejectionReasons.push(
      minProfileFaces === 1
        ? 'No clear face found in this photo'
        : `Need ${minProfileFaces} profile photos with a clear face (found ${profileEmbeddings.length})`,
    );
  }

  const scores = profileEmbeddings.map((p) => cosineSimilarity(embedding, p));
  const best = scores.length ? Math.max(...scores) : 0;
  const avg = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  const confidence = best * 0.7 + avg * 0.3;

  if (scores.length && confidence < MIN_MATCH_THRESHOLD) {
    rejectionReasons.push(
      `Face match too low (${confidence.toFixed(2)}, need ${MIN_MATCH_THRESHOLD})`,
    );
  }

  return {
    verified: rejectionReasons.length === 0,
    confidence: Math.round(confidence * 1000) / 1000,
    scores: scores.map((s) => Math.round(s * 10000) / 10000),
    faceDetectedInSelfie: true,
    profileFacesDetected: profileEmbeddings.length,
    rejectionReasons,
  };
}
