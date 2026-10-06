// VNGeneratePersonSegmentationRequest を Node から使うための N-API アドオン
// レンダラーから受け取った RGBA フレームに対して人物マスク（1ch, 0-255）を返す

#import <Foundation/Foundation.h>
#import <CoreVideo/CoreVideo.h>
#import <Vision/Vision.h>

#include <node_api.h>

#include <cstring>
#include <mutex>
#include <string>
#include <vector>

namespace {

struct SegmentJob {
    napi_async_work work = nullptr;
    napi_deferred deferred = nullptr;

    std::vector<uint8_t> rgba;
    size_t width = 0;
    size_t height = 0;
    int quality = 1; // 0: fast, 1: balanced, 2: accurate

    std::vector<uint8_t> mask;
    size_t maskWidth = 0;
    size_t maskHeight = 0;
    std::string error;
};

// 動画用に VNSequenceRequestHandler を使い回す（フレーム間で結果が安定する）
std::mutex gVisionMutex;
VNSequenceRequestHandler *gHandler = nil;
VNGeneratePersonSegmentationRequest *gRequest = nil;
size_t gLastWidth = 0;
size_t gLastHeight = 0;
int gLastQuality = -1;

bool IsSupported() {
    if (@available(macOS 12.0, *)) {
        return true;
    }
    return false;
}

void RunSegmentation(SegmentJob *job) API_AVAILABLE(macos(12.0)) {
    std::lock_guard<std::mutex> lock(gVisionMutex);

    // サイズや品質が変わったらハンドラを作り直す
    if (!gHandler || job->width != gLastWidth || job->height != gLastHeight || job->quality != gLastQuality) {
        gHandler = [[VNSequenceRequestHandler alloc] init];
        gRequest = [[VNGeneratePersonSegmentationRequest alloc] init];
        switch (job->quality) {
            case 0: gRequest.qualityLevel = VNGeneratePersonSegmentationRequestQualityLevelFast; break;
            case 2: gRequest.qualityLevel = VNGeneratePersonSegmentationRequestQualityLevelAccurate; break;
            default: gRequest.qualityLevel = VNGeneratePersonSegmentationRequestQualityLevelBalanced; break;
        }
        gRequest.outputPixelFormat = kCVPixelFormatType_OneComponent8;
        gLastWidth = job->width;
        gLastHeight = job->height;
        gLastQuality = job->quality;
    }

    // RGBA -> BGRA の CVPixelBuffer を作成
    CVPixelBufferRef input = NULL;
    NSDictionary *attrs = @{ (id)kCVPixelBufferIOSurfacePropertiesKey: @{} };
    CVReturn cvr = CVPixelBufferCreate(kCFAllocatorDefault, job->width, job->height,
                                       kCVPixelFormatType_32BGRA,
                                       (__bridge CFDictionaryRef)attrs, &input);
    if (cvr != kCVReturnSuccess || !input) {
        job->error = "CVPixelBufferCreate failed";
        return;
    }

    CVPixelBufferLockBaseAddress(input, 0);
    uint8_t *dstBase = (uint8_t *)CVPixelBufferGetBaseAddress(input);
    const size_t dstStride = CVPixelBufferGetBytesPerRow(input);
    const uint8_t *src = job->rgba.data();
    for (size_t y = 0; y < job->height; y++) {
        uint8_t *dst = dstBase + y * dstStride;
        const uint8_t *s = src + y * job->width * 4;
        for (size_t x = 0; x < job->width; x++) {
            dst[0] = s[2];
            dst[1] = s[1];
            dst[2] = s[0];
            dst[3] = 255;
            dst += 4;
            s += 4;
        }
    }
    CVPixelBufferUnlockBaseAddress(input, 0);

    NSError *error = nil;
    BOOL ok = [gHandler performRequests:@[ gRequest ]
                        onCVPixelBuffer:input
                            orientation:kCGImagePropertyOrientationUp
                                  error:&error];
    CVPixelBufferRelease(input);

    if (!ok) {
        job->error = error ? std::string(error.localizedDescription.UTF8String) : "performRequests failed";
        return;
    }

    VNPixelBufferObservation *observation = gRequest.results.firstObject;
    if (!observation) {
        job->error = "no segmentation result";
        return;
    }

    CVPixelBufferRef maskBuffer = observation.pixelBuffer;
    CVPixelBufferLockBaseAddress(maskBuffer, kCVPixelBufferLock_ReadOnly);
    const uint8_t *maskBase = (const uint8_t *)CVPixelBufferGetBaseAddress(maskBuffer);
    const size_t maskStride = CVPixelBufferGetBytesPerRow(maskBuffer);
    job->maskWidth = CVPixelBufferGetWidth(maskBuffer);
    job->maskHeight = CVPixelBufferGetHeight(maskBuffer);
    job->mask.resize(job->maskWidth * job->maskHeight);
    for (size_t y = 0; y < job->maskHeight; y++) {
        memcpy(job->mask.data() + y * job->maskWidth, maskBase + y * maskStride, job->maskWidth);
    }
    CVPixelBufferUnlockBaseAddress(maskBuffer, kCVPixelBufferLock_ReadOnly);
}

void Execute(napi_env env, void *data) {
    SegmentJob *job = static_cast<SegmentJob *>(data);
    @autoreleasepool {
        if (@available(macOS 12.0, *)) {
            RunSegmentation(job);
        } else {
            job->error = "person segmentation requires macOS 12 or later";
        }
    }
}

void Complete(napi_env env, napi_status status, void *data) {
    SegmentJob *job = static_cast<SegmentJob *>(data);

    if (status != napi_ok || !job->error.empty()) {
        napi_value message, err;
        napi_create_string_utf8(env, job->error.empty() ? "segmentation cancelled" : job->error.c_str(),
                                NAPI_AUTO_LENGTH, &message);
        napi_create_error(env, nullptr, message, &err);
        napi_reject_deferred(env, job->deferred, err);
    } else {
        napi_value result, width, height, buffer;
        napi_create_object(env, &result);
        napi_create_uint32(env, (uint32_t)job->maskWidth, &width);
        napi_create_uint32(env, (uint32_t)job->maskHeight, &height);
        napi_create_buffer_copy(env, job->mask.size(), job->mask.data(), nullptr, &buffer);
        napi_set_named_property(env, result, "width", width);
        napi_set_named_property(env, result, "height", height);
        napi_set_named_property(env, result, "data", buffer);
        napi_resolve_deferred(env, job->deferred, result);
    }

    napi_delete_async_work(env, job->work);
    delete job;
}

napi_value ThrowTypeError(napi_env env, const char *message) {
    napi_throw_type_error(env, nullptr, message);
    return nullptr;
}

// segment(rgba: TypedArray, width: number, height: number, quality?: string) => Promise
napi_value Segment(napi_env env, napi_callback_info info) {
    size_t argc = 4;
    napi_value argv[4];
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc < 3) {
        return ThrowTypeError(env, "segment(rgba, width, height, quality?) requires 3 arguments");
    }

    bool isTypedArray = false;
    napi_is_typedarray(env, argv[0], &isTypedArray);
    if (!isTypedArray) {
        return ThrowTypeError(env, "rgba must be a TypedArray");
    }
    napi_typedarray_type type;
    size_t length;
    void *pixels;
    napi_value arrayBuffer;
    size_t byteOffset;
    napi_get_typedarray_info(env, argv[0], &type, &length, &pixels, &arrayBuffer, &byteOffset);
    if (type != napi_uint8_array && type != napi_uint8_clamped_array) {
        return ThrowTypeError(env, "rgba must be a Uint8Array or Uint8ClampedArray");
    }

    uint32_t width = 0, height = 0;
    if (napi_get_value_uint32(env, argv[1], &width) != napi_ok ||
        napi_get_value_uint32(env, argv[2], &height) != napi_ok ||
        width == 0 || height == 0) {
        return ThrowTypeError(env, "width and height must be positive integers");
    }
    if (length < (size_t)width * height * 4) {
        return ThrowTypeError(env, "rgba buffer is smaller than width * height * 4");
    }

    int quality = 1;
    if (argc >= 4) {
        char buf[16] = {0};
        size_t len = 0;
        if (napi_get_value_string_utf8(env, argv[3], buf, sizeof(buf), &len) == napi_ok) {
            if (strcmp(buf, "fast") == 0) quality = 0;
            else if (strcmp(buf, "accurate") == 0) quality = 2;
        }
    }

    SegmentJob *job = new SegmentJob();
    job->width = width;
    job->height = height;
    job->quality = quality;
    job->rgba.assign((uint8_t *)pixels, (uint8_t *)pixels + (size_t)width * height * 4);

    napi_value promise, resourceName;
    napi_create_promise(env, &job->deferred, &promise);
    napi_create_string_utf8(env, "PersonSegmentation", NAPI_AUTO_LENGTH, &resourceName);
    napi_create_async_work(env, nullptr, resourceName, Execute, Complete, job, &job->work);
    napi_queue_async_work(env, job->work);
    return promise;
}

napi_value IsSupportedJs(napi_env env, napi_callback_info info) {
    napi_value result;
    napi_get_boolean(env, IsSupported(), &result);
    return result;
}

napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor props[] = {
        { "segment", nullptr, Segment, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "isSupported", nullptr, IsSupportedJs, nullptr, nullptr, nullptr, napi_default, nullptr },
    };
    napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
    return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
