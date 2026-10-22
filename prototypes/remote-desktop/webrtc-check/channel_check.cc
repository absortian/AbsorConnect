// Extremo efímero de laboratorio: solo autenticación v1. Sin captura, entrada ni archivos remotos.
#include <array>
#include <atomic>
#include <chrono>
#include <fstream>
#include <filesystem>
#include <future>
#include <functional>
#include <iostream>
#include <memory>
#include <sstream>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "api/create_modular_peer_connection_factory.h"
#include "api/data_channel_interface.h"
#include "api/environment/environment_factory.h"
#include "api/jsep.h"
#include "api/make_ref_counted.h"
#include "api/peer_connection_interface.h"
#include "api/set_local_description_observer_interface.h"
#include "api/set_remote_description_observer_interface.h"
#include "json/json.h"
#include "openssl/crypto.h"
#include "openssl/evp.h"
#include "openssl/hmac.h"
#include "openssl/rand.h"
#include "rtc_base/ssl_adapter.h"
#include "rtc_base/thread.h"
#include "vectors.h"
#ifdef ABSOR_SYNTHETIC_VIDEO
// GN también analiza la variante sin medios; este include solo existe en video_channel_check.
#include "synthetic_video.h"  // nogncheck
#endif

namespace {
using BoolResult = std::shared_ptr<std::promise<bool>>;
constexpr auto kTimeout = std::chrono::seconds(20);

std::string Encode(const uint8_t* bytes, size_t size) {
  std::vector<uint8_t> output(4 * ((size + 2) / 3) + 1);
  const size_t length = EVP_EncodeBlock(output.data(), bytes, size);
  return std::string(reinterpret_cast<const char*>(output.data()), length);
}

std::string Fingerprint(const std::string& sdp) {
  std::istringstream lines(sdp);
  std::string line;
  while (std::getline(lines, line)) {
    if (line.starts_with("a=fingerprint:")) {
      line.erase(0, 14);
      while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
      return line;
    }
  }
  return {};
}

bool Wait(std::future<bool>& future) {
  return future.wait_for(kTimeout) == std::future_status::ready && future.get();
}

class RemoteSet : public webrtc::SetRemoteDescriptionObserverInterface {
 public:
  explicit RemoteSet(BoolResult result) : result_(std::move(result)) {}
  void OnSetRemoteDescriptionComplete(webrtc::RTCError error) override {
    result_->set_value(error.ok());
  }
 private:
  BoolResult result_;
};

class LocalSet : public webrtc::SetLocalDescriptionObserverInterface {
 public:
  explicit LocalSet(BoolResult result) : result_(std::move(result)) {}
  void OnSetLocalDescriptionComplete(webrtc::RTCError error) override {
    result_->set_value(error.ok());
  }
 private:
  BoolResult result_;
};

class Answer : public webrtc::CreateSessionDescriptionObserver {
 public:
  using Result = std::shared_ptr<std::promise<std::unique_ptr<webrtc::SessionDescriptionInterface>>>;
  explicit Answer(Result result) : result_(std::move(result)) {}
  void OnSuccess(webrtc::SessionDescriptionInterface* value) override {
    result_->set_value(std::unique_ptr<webrtc::SessionDescriptionInterface>(value));
  }
  void OnFailure(webrtc::RTCError) override { result_->set_value(nullptr); }
 private:
  Result result_;
};

class Observer final : public webrtc::PeerConnectionObserver, public webrtc::DataChannelObserver {
 public:
  explicit Observer(webrtc::Thread* signaling) : signaling_(signaling) {
    std::array<uint8_t, 32> bytes{};
    if (RAND_bytes(bytes.data(), bytes.size())) nonce = Encode(bytes.data(), bytes.size());
  }

  std::promise<bool> gathered;
  std::promise<bool> acknowledged;
  std::string offer_fingerprint;
  std::string answer_fingerprint;
  std::string nonce;
  bool authenticated = false;
  bool attempted = false;
  bool connected = false;
  std::function<void()> on_authenticated;
  webrtc::scoped_refptr<webrtc::DataChannelInterface> channel;

  void OnSignalingChange(webrtc::PeerConnectionInterface::SignalingState) override {}
  void OnIceCandidate(const webrtc::IceCandidate*) override {}
  void OnConnectionChange(webrtc::PeerConnectionInterface::PeerConnectionState state) override {
    if (state == webrtc::PeerConnectionInterface::PeerConnectionState::kConnected) connected = true;
  }
  void OnIceGatheringChange(webrtc::PeerConnectionInterface::IceGatheringState state) override {
    if (state == webrtc::PeerConnectionInterface::kIceGatheringComplete && !gathered_.exchange(true)) {
      gathered.set_value(true);
    }
  }
  void OnDataChannel(webrtc::scoped_refptr<webrtc::DataChannelInterface> incoming) override {
    if (channel || incoming->label() != "control") {
      incoming->Close();
      return;
    }
    channel = std::move(incoming);
    channel->RegisterObserver(this);
    OnStateChange();
  }
  void OnStateChange() override {
    // La API exige salir del callback antes de volver a llamar a WebRTC.
    signaling_->PostTask([this] {
      if (!channel || channel->state() != webrtc::DataChannelInterface::kOpen || hello_sent_) return;
      hello_sent_ = true;
      const auto& vector = kVectors.back();
      Json::Value hello;
      hello["v"] = 1;
      hello["type"] = "hello";
      hello["hostName"] = "Host nativo de laboratorio";
      hello["salt"] = vector.salt;
      hello["iterations"] = vector.iterations;
      hello["nonce"] = nonce;
      Send(hello);
    });
  }
  void OnMessage(const webrtc::DataBuffer& buffer) override {
    if (buffer.binary || buffer.size() > 512) return;
    std::string text(reinterpret_cast<const char*>(buffer.data.data()), buffer.size());
    signaling_->PostTask([this, text = std::move(text)] {
      Json::Value message;
      Json::CharReaderBuilder builder;
      builder["rejectDupKeys"] = true;
      builder["failIfExtra"] = true;
      std::string errors;
      auto reader = std::unique_ptr<Json::CharReader>(builder.newCharReader());
      std::istringstream input(text);
      if (!Json::parseFromStream(builder, input, &message, &errors) ||
          !message.isObject() || message["v"] != 1 || !message["type"].isString()) return;
      if (message["type"] == "bye" && attempted && !acknowledged_) {
        acknowledged_ = true;
        acknowledged.set_value(true);
        return;
      }
      if (message["type"] != "auth" || attempted || !hello_sent_ ||
          !message["proof"].isString() || message["proof"].asString().size() > 256) return;
      attempted = true;
      authenticated = Verify(message["proof"].asString());
      Json::Value result;
      result["v"] = 1;
      result["type"] = "auth-result";
      result["ok"] = authenticated;
      if (!authenticated) result["reason"] = "wrong_password";
      Send(result);
      if (authenticated && on_authenticated) on_authenticated();
    });
  }

  void Detach() {
    if (channel) {
      channel->UnregisterObserver();
      channel->Close();
      channel = nullptr;
    }
  }

 private:
  void Send(const Json::Value& value) {
    Json::StreamWriterBuilder builder;
    builder["indentation"] = "";
    channel->Send(webrtc::DataBuffer(Json::writeString(builder, value)));
  }
  bool Verify(const std::string& proof) {
    if (nonce.empty() || offer_fingerprint.empty() || answer_fingerprint.empty()) return false;
    const auto& encoded_key = kVectors.back().key;
    std::array<uint8_t, 64> key{};
    size_t key_length = 0;
    if (!EVP_DecodeBase64(key.data(), &key_length, key.size(),
                         reinterpret_cast<const uint8_t*>(encoded_key.data()), encoded_key.size()) ||
        key_length != 32) return false;
    const auto payload = std::string("absor-remote-auth-v1\n") + nonce + "\n" +
                         offer_fingerprint + "\n" + answer_fingerprint;
    std::array<uint8_t, EVP_MAX_MD_SIZE> digest{};
    unsigned int size = 0;
    if (!HMAC(EVP_sha256(), key.data(), key_length,
              reinterpret_cast<const uint8_t*>(payload.data()), payload.size(),
              digest.data(), &size)) return false;
    const auto expected = Encode(digest.data(), size);
    return proof.size() == expected.size() &&
           CRYPTO_memcmp(proof.data(), expected.data(), proof.size()) == 0;
  }
  webrtc::Thread* signaling_;
  std::atomic<bool> gathered_{false};
  bool acknowledged_ = false;
  bool hello_sent_ = false;
};

bool Exchange(webrtc::scoped_refptr<webrtc::PeerConnectionInterface> connection,
              Observer& observer, webrtc::Thread* signaling,
              const std::string& offer_text, const char* answer_path) {
  observer.offer_fingerprint = Fingerprint(offer_text);
  auto description = webrtc::CreateSessionDescription(webrtc::SdpType::kOffer, offer_text);
  if (!description || observer.offer_fingerprint.empty() || observer.nonce.empty()) return false;
  auto remote = std::make_shared<std::promise<bool>>();
  auto remote_future = remote->get_future();
  connection->SetRemoteDescription(std::move(description), webrtc::make_ref_counted<RemoteSet>(remote));
  if (!Wait(remote_future)) return false;
#ifdef ABSOR_SYNTHETIC_VIDEO
  bool directions_ok = true;
  signaling->BlockingCall([&] {
    for (const auto& transceiver : connection->GetTransceivers()) {
      if (!transceiver->SetDirectionWithError(webrtc::RtpTransceiverDirection::kSendOnly).ok()) directions_ok = false;
    }
  });
  if (!directions_ok) return false;
#endif
  auto answer_result = std::make_shared<std::promise<std::unique_ptr<webrtc::SessionDescriptionInterface>>>();
  auto answer_future = answer_result->get_future();
  auto callback = webrtc::make_ref_counted<Answer>(answer_result);
  connection->CreateAnswer(callback.get(), webrtc::PeerConnectionInterface::RTCOfferAnswerOptions());
  if (answer_future.wait_for(kTimeout) != std::future_status::ready) return false;
  auto answer = answer_future.get();
  if (!answer) return false;
  std::string initial_sdp;
  signaling->BlockingCall([&] { answer->ToString(&initial_sdp); });
  observer.answer_fingerprint = Fingerprint(initial_sdp);
  auto gathered_future = observer.gathered.get_future();
  auto local = std::make_shared<std::promise<bool>>();
  auto local_future = local->get_future();
  connection->SetLocalDescription(std::move(answer), webrtc::make_ref_counted<LocalSet>(local));
  if (!Wait(local_future) || !Wait(gathered_future)) return false;
  std::string final_sdp;
  signaling->BlockingCall([&] { connection->local_description()->ToString(&final_sdp); });
  if (final_sdp.size() > 262144) return false;
  // El controlador crea la carpeta privada y espera este archivo antes de leerlo.
  const auto temporary = std::string(answer_path) + ".part";
  { std::ofstream file(temporary, std::ios::binary); file << final_sdp; if (!file) return false; }
  std::error_code rename_error;
  std::filesystem::rename(temporary, answer_path, rename_error);
  if (rename_error) return false;
  auto acknowledged = observer.acknowledged.get_future();
  return Wait(acknowledged);
}

int Run(const std::string& offer, const char* answer_path) {
  auto network = webrtc::Thread::CreateWithSocketServer();
  auto signaling = webrtc::Thread::Create();
  if (!network->Start() || !signaling->Start()) return 2;
  webrtc::PeerConnectionFactoryDependencies dependencies;
  dependencies.env = webrtc::CreateEnvironment();
  dependencies.network_thread = network.get();
  dependencies.signaling_thread = signaling.get();
#ifdef ABSOR_SYNTHETIC_VIDEO
  absor_lab::EnableSyntheticMedia(dependencies);
#endif
  auto factory = webrtc::CreateModularPeerConnectionFactory(std::move(dependencies));
  if (!factory) return 3;
  Observer observer(signaling.get());
  webrtc::PeerConnectionInterface::RTCConfiguration configuration;
  auto connection_result = factory->CreatePeerConnectionOrError(
      configuration, webrtc::PeerConnectionDependencies(&observer));
  if (!connection_result.ok()) return 4;
  auto connection = connection_result.MoveValue();
#ifdef ABSOR_SYNTHETIC_VIDEO
  absor_lab::SyntheticVideo video;
  observer.on_authenticated = [&] { video.Start(factory.get(), connection.get()); };
  int synthetic_frames = 0;
#endif
  const bool exchanged = Exchange(connection, observer, signaling.get(), offer, answer_path);
  bool connected = false;
  bool authenticated = false;
  signaling->BlockingCall([&] {
    connected = observer.connected;
    authenticated = observer.authenticated;
#ifdef ABSOR_SYNTHETIC_VIDEO
    synthetic_frames = video.Stop();
#endif
    observer.Detach();
    connection->Close();
  });
  connection = nullptr;
  factory = nullptr;
  signaling->Stop();
  network->Stop();
  if (!exchanged || !connected) return 5;
  std::cout << "{\"dtlsConnected\":true,\"authenticated\":"
            << (authenticated ? "true" : "false")
            << ",\"captureStarted\":false,\"inputEnabled\":false"
#ifdef ABSOR_SYNTHETIC_VIDEO
            << ",\"syntheticVideoFrames\":" << synthetic_frames
#endif
            << "}\n";
  return 0;
}
}  // namespace

int main(int argc, char** argv) {
  if (argc != 3) { std::cerr << "Uso: channel_check <oferta.sdp> <respuesta.sdp>\n"; return 64; }
  // Límite de la ABI de C: argc validado garantiza tres elementos accesibles en argv.
#pragma clang unsafe_buffer_usage begin
  const std::span<char*> arguments(argv, static_cast<size_t>(argc));
#pragma clang unsafe_buffer_usage end
  std::ifstream file(arguments[1], std::ios::binary | std::ios::ate);
  if (!file || file.tellg() < 0 || file.tellg() > 262144) return 65;
  file.seekg(0);
  std::string offer((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
  if (!webrtc::InitializeSSL()) return 1;
  const int result = Run(offer, arguments[2]);
  webrtc::CleanupSSL();
  return result;
}
