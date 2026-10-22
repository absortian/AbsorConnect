// Oferta local sin aplicarla: no hay ICE ni captura, y no se imprime el SDP.
#include <chrono>
#include <future>
#include <iostream>
#include <memory>
#include <string>
#include <utility>

#include "api/create_modular_peer_connection_factory.h"
#include "api/data_channel_interface.h"
#include "api/environment/environment_factory.h"
#include "api/jsep.h"
#include "api/make_ref_counted.h"
#include "api/peer_connection_interface.h"
#include "rtc_base/ssl_adapter.h"
#include "rtc_base/thread.h"

namespace {
class PeerObserver final : public webrtc::PeerConnectionObserver {
 public:
  void OnSignalingChange(webrtc::PeerConnectionInterface::SignalingState) override {}
  void OnDataChannel(webrtc::scoped_refptr<webrtc::DataChannelInterface>) override {}
  void OnIceGatheringChange(webrtc::PeerConnectionInterface::IceGatheringState) override {}
  void OnIceCandidate(const webrtc::IceCandidate*) override {}
};

class OfferObserver : public webrtc::CreateSessionDescriptionObserver {
 public:
  explicit OfferObserver(std::shared_ptr<std::promise<bool>> result)
      : result_(std::move(result)) {}

  void OnSuccess(webrtc::SessionDescriptionInterface* raw) override {
    std::unique_ptr<webrtc::SessionDescriptionInterface> description(raw);
    std::string sdp;
    const bool valid = description && description->ToString(&sdp) &&
        sdp.find("a=fingerprint:sha-256 ") != std::string::npos &&
        sdp.find("m=application ") != std::string::npos &&
        sdp.find("UDP/DTLS/SCTP") != std::string::npos;
    result_->set_value(valid);
  }

  void OnFailure(webrtc::RTCError) override { result_->set_value(false); }

 private:
  std::shared_ptr<std::promise<bool>> result_;
};

bool CheckOffer() {
  auto network = webrtc::Thread::CreateWithSocketServer();
  auto signaling = webrtc::Thread::Create();
  if (!network->Start() || !signaling->Start()) return false;
  webrtc::PeerConnectionFactoryDependencies dependencies;
  dependencies.env = webrtc::CreateEnvironment();
  dependencies.network_thread = network.get();
  dependencies.signaling_thread = signaling.get();
  auto factory = webrtc::CreateModularPeerConnectionFactory(std::move(dependencies));
  if (!factory) return false;
  PeerObserver observer;
  webrtc::PeerConnectionInterface::RTCConfiguration configuration;
  auto connection_result = factory->CreatePeerConnectionOrError(
      configuration, webrtc::PeerConnectionDependencies(&observer));
  if (!connection_result.ok()) return false;
  auto connection = connection_result.MoveValue();
  bool success = false;
  {
    webrtc::DataChannelInit options;
    auto channel = connection->CreateDataChannelOrError("control", &options);
    if (channel.ok()) {
      auto result = std::make_shared<std::promise<bool>>();
      auto future = result->get_future();
      auto callback = webrtc::make_ref_counted<OfferObserver>(result);
      connection->CreateOffer(callback.get(),
                              webrtc::PeerConnectionInterface::RTCOfferAnswerOptions());
      success = future.wait_for(std::chrono::seconds(10)) == std::future_status::ready &&
                future.get();
      channel.value()->Close();
    }
  }
  connection->Close();
  connection = nullptr;
  factory = nullptr;
  signaling->Stop();
  network->Stop();
  return success;
}
}  // namespace

int main() {
  if (!webrtc::InitializeSSL()) return 1;
  const bool success = CheckOffer();
  webrtc::CleanupSSL();
  if (!success) return 2;
  std::cout << "{\"dataChannelCreated\":true,\"offerCreated\":true,"
               "\"sha256FingerprintPresent\":true,\"sdpApplied\":false,"
               "\"dtlsEstablished\":false,\"transportTested\":false}\n";
  return 0;
}
