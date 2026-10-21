# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# @generated begin expo-build-properties - expo prebuild (DO NOT MODIFY)
# --- On-device face verification (see services/faceVerification.ts) ---
# ML Kit face detection - loaded reflectively by Play Services
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_** { *; }
-dontwarn com.google.mlkit.**
# @react-native-ml-kit/face-detection bridge module
-keep class com.rnmlkit.facedetection.** { *; }
# TensorFlow Lite interpreter (MobileFaceNet embeddings)
-keep class org.tensorflow.** { *; }
-dontwarn org.tensorflow.**
# react-native-fast-tflite plus its Nitro Modules runtime, bound over JNI
-keep class com.margelo.nitro.** { *; }
# --- Play Billing (expo-iap -> OpenIAP -> Billing client) ---
-keep class expo.modules.iap.** { *; }
-keep class dev.hyo.openiap.** { *; }
-keep class com.android.billingclient.** { *; }
# Gson reads OpenIAP's JSON through TypeTokens: keep their generic signatures
-keepattributes Signature, InnerClasses, EnclosingMethod, *Annotation*
-keep class com.google.gson.reflect.TypeToken { *; }
-keep class * extends com.google.gson.reflect.TypeToken
# @generated end expo-build-properties