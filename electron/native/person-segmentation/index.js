// macOS Vision (VNGeneratePersonSegmentationRequest) による人物セグメンテーション
// segment(rgba, width, height, quality) => Promise<{ width, height, data }>
//   rgba: RGBA 8bit の TypedArray, quality: 'fast' | 'balanced' | 'accurate'
//   data: 人物らしさ 0-255 の 1ch マスク（width x height）
module.exports = require('./build/Release/person_segmentation.node');
