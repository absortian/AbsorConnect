// Ventana X11 propia de la VM → RGB autorizado por Rust → pista VP8 de laboratorio.
#pragma once
#include <vector>
#include "synthetic_video.h"
#include "absor_bridge.h"

namespace absor_lab {
class NativeFixtureSource : public webrtc::AdaptedVideoTrackSource {
 public:
  explicit NativeFixtureSource(uint64_t bridge) : bridge_(bridge) {}
  SourceState state() const override { return kLive; }
  bool remote() const override { return false; }
  bool is_screencast() const override { return true; }
  std::optional<bool> needs_denoising() const override { return false; }
  ~NativeFixtureSource() override { Stop(); }
  void Start() {
    running_ = true;
    producer_ = std::thread([this] {
      std::vector<uint8_t> rgb(320 * 180 * 3);
      while (running_) {
        const int result = absor_bridge_native_frame(bridge_, rgb.data(), rgb.size());
        if (result < 0) break;
        if (result == static_cast<int>(rgb.size()) && running_) {
          auto buffer = webrtc::I420Buffer::Create(320, 180);
          // Buffers propios de tamaños fijos; planos/strides de I420Buffer.
#pragma clang unsafe_buffer_usage begin
          std::span<uint8_t> y(buffer->MutableDataY(), buffer->StrideY() * 180);
          std::span<uint8_t> u(buffer->MutableDataU(), buffer->StrideU() * 90);
          std::span<uint8_t> v(buffer->MutableDataV(), buffer->StrideV() * 90);
#pragma clang unsafe_buffer_usage end
          for (int row = 0; row < 180; ++row) {
            for (int col = 0; col < 320; ++col) {
              const size_t pixel = (row * 320 + col) * 3;
              const int red = rgb[pixel], green = rgb[pixel + 1], blue = rgb[pixel + 2];
              y[row * buffer->StrideY() + col] = ((66 * red + 129 * green + 25 * blue + 128) >> 8) + 16;
              if (row % 2 == 0 && col % 2 == 0) {
                const size_t index = row / 2 * buffer->StrideU() + col / 2;
                u[index] = ((-38 * red - 74 * green + 112 * blue + 128) >> 8) + 128;
                v[row / 2 * buffer->StrideV() + col / 2] = ((112 * red - 94 * green - 18 * blue + 128) >> 8) + 128;
              }
            }
          }
          const auto now = std::chrono::duration_cast<std::chrono::microseconds>(
              std::chrono::steady_clock::now().time_since_epoch()).count();
          OnFrame(webrtc::VideoFrame::Builder().set_video_frame_buffer(buffer)
                      .set_timestamp_us(now).set_rotation(webrtc::kVideoRotation_0).build());
          ++frames_;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
      }
    });
  }
  void Stop() { running_ = false; if (producer_.joinable()) producer_.join(); }
  int frames() const { return frames_; }
 private:
  const uint64_t bridge_;
  std::atomic<bool> running_{false};
  std::atomic<int> frames_{0};
  std::thread producer_;
};
class NativeFixtureVideo {
 public:
  bool Start(webrtc::PeerConnectionFactoryInterface* factory,
             webrtc::PeerConnectionInterface* connection, uint64_t bridge) {
    for (const auto& transceiver : connection->GetTransceivers()) {
      if (transceiver->media_type() != webrtc::MediaType::VIDEO) continue;
      source_ = webrtc::make_ref_counted<NativeFixtureSource>(bridge);
      auto track = factory->CreateVideoTrack(source_, "native-window-lab");
      if (!transceiver->sender()->SetTrack(track.get())) { source_ = nullptr; return false; }
      source_->Start();
      return true;
    }
    return false;
  }
  int Stop() {
    if (!source_) return 0;
    source_->Stop();
    const int frames = source_->frames();
    source_ = nullptr;
    return frames;
  }
 private:
  webrtc::scoped_refptr<NativeFixtureSource> source_;
};
}  // namespace absor_lab
