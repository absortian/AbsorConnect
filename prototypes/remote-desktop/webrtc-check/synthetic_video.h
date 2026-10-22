// Vídeo artificial para comprobar codificación/transporte. No captura ninguna pantalla.
#pragma once
#include <algorithm>
#include <atomic>
#include <chrono>
#include <memory>
#include <span>
#include <thread>

#include "api/audio_codecs/builtin_audio_decoder_factory.h"
#include "api/audio_codecs/builtin_audio_encoder_factory.h"
#include "api/enable_media.h"
#include "api/media_types.h"
#include "api/rtp_transceiver_interface.h"
#include "api/video/adapted_video_track_source.h"
#include "api/video/i420_buffer.h"
#include "api/video/video_frame.h"
#include "api/video_codecs/video_decoder_factory_template.h"
#include "api/video_codecs/video_decoder_factory_template_libvpx_vp8_adapter.h"
#include "api/video_codecs/video_encoder_factory_template.h"
#include "api/video_codecs/video_encoder_factory_template_libvpx_vp8_adapter.h"
#include "modules/audio_device/audio_device_impl.h"

namespace absor_lab {
inline void EnableSyntheticMedia(webrtc::PeerConnectionFactoryDependencies& dependencies) {
  dependencies.audio_encoder_factory = webrtc::CreateBuiltinAudioEncoderFactory();
  dependencies.audio_decoder_factory = webrtc::CreateBuiltinAudioDecoderFactory();
  // Dispositivo vacío: nunca inicializa micrófono, altavoz ni un dispositivo de audio real.
  dependencies.adm = webrtc::AudioDeviceModuleImpl::Create(
      *dependencies.env, webrtc::AudioDeviceModule::kDummyAudio);
  dependencies.video_encoder_factory = std::make_unique<webrtc::VideoEncoderFactoryTemplate<
      webrtc::LibvpxVp8EncoderTemplateAdapter>>();
  dependencies.video_decoder_factory = std::make_unique<webrtc::VideoDecoderFactoryTemplate<
      webrtc::LibvpxVp8DecoderTemplateAdapter>>();
  webrtc::EnableMedia(dependencies);
}

class SyntheticSource : public webrtc::AdaptedVideoTrackSource {
 public:
  SourceState state() const override { return kLive; }
  bool remote() const override { return false; }
  bool is_screencast() const override { return true; }
  std::optional<bool> needs_denoising() const override { return false; }
  ~SyntheticSource() override { Stop(); }

  void Start() {
    running_ = true;
    producer_ = std::thread([this] {
      while (running_) {
        auto buffer = webrtc::I420Buffer::Create(320, 180);
        // Límites de los planos proporcionados por el propio I420Buffer recién creado.
#pragma clang unsafe_buffer_usage begin
        std::span<uint8_t> y(buffer->MutableDataY(), buffer->StrideY() * 180);
        std::span<uint8_t> u(buffer->MutableDataU(), buffer->StrideU() * 90);
        std::span<uint8_t> v(buffer->MutableDataV(), buffer->StrideV() * 90);
#pragma clang unsafe_buffer_usage end
        std::fill(y.begin(), y.end(), 76);
        std::fill(u.begin(), u.end(), 84);
        std::fill(v.begin(), v.end(), 255);
        auto now = std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::steady_clock::now().time_since_epoch()).count();
        OnFrame(webrtc::VideoFrame::Builder().set_video_frame_buffer(buffer)
                    .set_timestamp_us(now).set_rotation(webrtc::kVideoRotation_0).build());
        ++frames_;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
      }
    });
  }
  void Stop() { running_ = false; if (producer_.joinable()) producer_.join(); }
  int frames() const { return frames_; }
 private:
  std::atomic<bool> running_{false};
  std::atomic<int> frames_{0};
  std::thread producer_;
};

class SyntheticVideo {
 public:
  bool Start(webrtc::PeerConnectionFactoryInterface* factory,
             webrtc::PeerConnectionInterface* connection) {
    for (const auto& transceiver : connection->GetTransceivers()) {
      if (transceiver->media_type() != webrtc::MediaType::VIDEO) continue;
      source_ = webrtc::make_ref_counted<SyntheticSource>();
      auto track = factory->CreateVideoTrack(source_, "synthetic-lab");
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
  webrtc::scoped_refptr<SyntheticSource> source_;
};
}  // namespace absor_lab
