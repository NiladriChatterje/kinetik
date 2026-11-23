# ai_image_detector.tflite

Source: `pe_tiny/model.onnx` from https://huggingface.co/Deckard618/imdet
(revision 17e493fd263f9195999d01dde1eee78ea8956638, ONNX sha256 87cf796d2ca7cd20…),
licensed under the Apache License, Version 2.0 (full text: `ai_image_detector.LICENSE.txt`).

Upstream NOTICE: derived from Meta's Perception Encoder (PE-Core T16),
Copyright (c) Meta Platforms, Inc. and affiliates, Apache License 2.0
(https://github.com/facebookresearch/perception_models), trained by the
upstream author for binary fake/real image classification.

Changes made for Kinetik (2026-11-23):
- simplified with onnxsim, input fixed at 1×3×256×256;
- converted to TFLite with onnx2tf 1.28.8 (TensorFlow 2.19.1), one MatMul input
  transposed through a parameter-replacement file (`/backbone/attn_pool/MatMul`,
  input `/backbone/attn_pool/Mul_1_output_0`, perm [0, 3, 1, 2]);
- dynamic-range quantization (int8 weights, float32 input/output).

Input: float32 [1, 256, 256, 3] NHWC, RGB scaled to 0–1 (shorter side resized to
256 bilinear, centre crop 256). Output: float32 [1, 2] logits, index 0 = AI-generated,
index 1 = real; softmax gives the probability.

Converted model sha256: 9c2865fb56798baf637dc897c866150cc0271f394d06e0fc1810ff468e86e85b

Measured 2026-11-23 through the app's own pipeline (1200 px WebP 0.85, 256 crop, JPEG hand-off):
at p(AI) >= 0.9, 0 of 51 live profile photos flagged, 26 of 75 AI portraits from 16
generators (ComplexDataLab/OpenFake test split) flagged. Misses most GPT-image,
Nano Banana Pro, FLUX.2 and Recraft portraits.
