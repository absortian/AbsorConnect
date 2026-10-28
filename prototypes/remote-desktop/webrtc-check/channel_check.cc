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
#include <thread>
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
#ifdef ABSOR_RUST_BRIDGE
#include "absor_bridge.h"  // nogncheck: solo rust_video_channel_check.
#include "api/units/time_delta.h"  // nogncheck: dependencia directa del target Rust.
#endif
#ifdef ABSOR_SYNTHETIC_VIDEO
// GN también analiza la variante sin medios; este include solo existe en video_channel_check.
#include "synthetic_video.h"  // nogncheck
#endif
#ifdef ABSOR_NATIVE_FIXTURE
#include "native_fixture_video.h"  // nogncheck
#endif

namespace {
using BoolResult = std::shared_ptr<std::promise<bool>>;
#ifdef ABSOR_RUST_BRIDGE
// El laboratorio incluye autenticación, comprobación visual y una pausa real de 31 s.
// Este plazo del ensayo no cambia la autorización del broker ni sus watchdogs.
constexpr auto kTimeout = std::chrono::seconds(75);
#else
constexpr auto kTimeout = std::chrono::seconds(20);
#endif

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

#ifdef ABSOR_NATIVE_FIXTURE
class FixtureInput final : public webrtc::DataChannelObserver {
 public:
  explicit FixtureInput(std::function<void(std::string)> receive) : receive_(std::move(receive)) {}
  void OnStateChange() override {}
  void OnMessage(const webrtc::DataBuffer& buffer) override {
    if (!buffer.binary && buffer.size() > 0 && buffer.size() <= 128)
      receive_(std::string(reinterpret_cast<const char*>(buffer.data.data()), buffer.size()));
  }
 private:
  std::function<void(std::string)> receive_;
};
#endif
class Observer final : public webrtc::PeerConnectionObserver, public webrtc::DataChannelObserver {
 public:
  explicit Observer(webrtc::Thread* signaling, bool server_candidates
#ifdef ABSOR_RUST_BRIDGE
      , uint64_t bridge
#endif
      ) :
#ifdef ABSOR_RUST_BRIDGE
      bridge_(bridge),
#endif
      signaling_(signaling), server_candidates_(server_candidates) {
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
  int completed_by = 0;
  std::function<void()> on_authenticated;
#ifdef ABSOR_RUST_BRIDGE
  std::function<void()> on_cut;
  int bridge_cut = 0;
  void Poll() {
    if (detached_) return;
    const int state = absor_bridge_poll(bridge_);
    if (state < 0) {
      bridge_cut = state;
      completed_by = 2;
      if (on_cut) on_cut();
      if (!acknowledged_) { acknowledged_ = true; acknowledged.set_value(true); }
      return;
    }
    if (authenticated) Control("");
    signaling_->PostDelayedTask([this] { Poll(); }, webrtc::TimeDelta::Millis(50));
  }
#endif
  webrtc::scoped_refptr<webrtc::DataChannelInterface> channel;

  void OnSignalingChange(webrtc::PeerConnectionInterface::SignalingState) override {}
  void OnIceCandidate(const webrtc::IceCandidate* candidate) override {
    // Con TURN puede seguir buscando otros caminos pese a tener candidatos utilizables.
    if (server_candidates_ && candidate && (candidate->candidate().is_relay() || candidate->candidate().is_stun()) && !gathered_.exchange(true)) {
      gathered.set_value(true);
    }
  }
  void OnConnectionChange(webrtc::PeerConnectionInterface::PeerConnectionState state) override {
    if (state == webrtc::PeerConnectionInterface::PeerConnectionState::kConnected) connected = true;
    if (authenticated && !acknowledged_ &&
        (state == webrtc::PeerConnectionInterface::PeerConnectionState::kClosed ||
         state == webrtc::PeerConnectionInterface::PeerConnectionState::kFailed)) {
      completed_by = 4;
      acknowledged_ = true;
      acknowledged.set_value(true);
    }
  }
  void OnIceGatheringChange(webrtc::PeerConnectionInterface::IceGatheringState state) override {
    if (state == webrtc::PeerConnectionInterface::kIceGatheringComplete && !gathered_.exchange(true)) {
      gathered.set_value(true);
    }
  }
  void OnDataChannel(webrtc::scoped_refptr<webrtc::DataChannelInterface> incoming) override {
#ifdef ABSOR_NATIVE_FIXTURE
    if (incoming->label() == "input" && !input_channel_) {
      input_channel_ = std::move(incoming);
      input_observer_ = std::make_unique<FixtureInput>([this](std::string text) {
        // Comprobar también al recibir: una entrada previa al reto no se encola
        // para ejecutarse después de autenticar.
        if (!authenticated || detached_) return;
        signaling_->PostTask([this, text = std::move(text)] {
          if (!authenticated || detached_) return;
          absor_bridge_native_input(bridge_, reinterpret_cast<const uint8_t*>(text.data()), text.size());
        });
      });
      input_channel_->RegisterObserver(input_observer_.get());
      return;
    }
#endif
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
      // En segundo plano el SO puede cerrar el transporte antes de entregar bye.
      // Solo finaliza un intercambio ya autenticado; una caída previa nunca lo acredita.
      if (channel && (channel->state() == webrtc::DataChannelInterface::kClosing || channel->state() == webrtc::DataChannelInterface::kClosed) && authenticated && !acknowledged_) {
        completed_by = 3;
        acknowledged_ = true;
        acknowledged.set_value(true);
      }
      if (!channel || channel->state() != webrtc::DataChannelInterface::kOpen || hello_sent_) return;
      hello_sent_ = true;
      Json::Value hello;
#ifdef ABSOR_RUST_BRIDGE
      std::array<uint8_t, 4096> output{};
      const int length = absor_bridge_hello(bridge_,
          reinterpret_cast<const uint8_t*>(offer_fingerprint.data()), offer_fingerprint.size(),
          reinterpret_cast<const uint8_t*>(answer_fingerprint.data()), answer_fingerprint.size(), output.data(), output.size());
      if (length == 0) {
        hello_sent_ = false;
        signaling_->PostDelayedTask([this] { OnStateChange(); }, webrtc::TimeDelta::Millis(50));
        return;
      }
      if (length < 0 || static_cast<size_t>(length) > output.size()) { Detach(); return; }
      std::istringstream encoded(std::string(reinterpret_cast<const char*>(output.data()), length));
      Json::CharReaderBuilder parser;
      std::string errors;
      if (!Json::parseFromStream(parser, encoded, &hello, &errors)) { Detach(); return; }
#else
      const auto& vector = kVectors.back();
      hello["v"] = 1;
      hello["type"] = "hello";
      hello["hostName"] = "Host nativo de laboratorio";
      hello["salt"] = vector.salt;
      hello["iterations"] = vector.iterations;
      hello["nonce"] = nonce;
#endif
      Send(hello);
    });
  }
  void OnMessage(const webrtc::DataBuffer& buffer) override {
    if (buffer.binary || buffer.size() > 2048) return;
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
        completed_by = 1;
        acknowledged_ = true;
        acknowledged.set_value(true);
        return;
      }
#ifdef ABSOR_RUST_BRIDGE
      if (authenticated && message.isMember("extension")) {
        Control(text);
        return;
      }
#endif
      if (message["type"] != "auth" || attempted || !hello_sent_ ||
          !message["proof"].isString() || message["proof"].asString().size() > 256) return;
      attempted = true;
#ifdef ABSOR_RUST_BRIDGE
      authenticated = absor_bridge_auth(bridge_, reinterpret_cast<const uint8_t*>(text.data()), text.size()) == 1;
#else
      authenticated = Verify(message["proof"].asString());
#endif
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
#ifdef ABSOR_NATIVE_FIXTURE
    if (input_channel_) {
      input_channel_->UnregisterObserver();
      input_channel_->Close();
      input_channel_ = nullptr;
    }
    input_observer_ = nullptr;
#endif
#ifdef ABSOR_RUST_BRIDGE
    detached_ = true;
#endif
    if (channel) {
      channel->UnregisterObserver();
      channel->Close();
      channel = nullptr;
    }
  }

 private:
#ifdef ABSOR_RUST_BRIDGE
  void Control(const std::string& text) {
    if (!authenticated || detached_ || !channel || channel->state() != webrtc::DataChannelInterface::kOpen) return;
    std::array<uint8_t, 8192> output{};
    const int length = absor_bridge_control(bridge_, reinterpret_cast<const uint8_t*>(text.data()), text.size(), output.data(), output.size());
    if (length < 0 || static_cast<size_t>(length) > output.size()) return;
    Json::Value messages;
    Json::CharReaderBuilder parser;
    std::string errors;
    std::istringstream input(std::string(reinterpret_cast<const char*>(output.data()), length));
    if (!Json::parseFromStream(parser, input, &messages, &errors) || !messages.isArray() || messages.size() > 3) return;
    for (const auto& message : messages) Send(message);
  }
#endif
#ifdef ABSOR_NATIVE_FIXTURE
  webrtc::scoped_refptr<webrtc::DataChannelInterface> input_channel_;
  std::unique_ptr<FixtureInput> input_observer_;
#endif
  void Send(const Json::Value& value) {
    Json::StreamWriterBuilder builder;
    builder["indentation"] = "";
    channel->Send(webrtc::DataBuffer(Json::writeString(builder, value)));
  }
#ifndef ABSOR_RUST_BRIDGE
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
#endif
#ifdef ABSOR_RUST_BRIDGE
  uint64_t bridge_;
  bool detached_ = false;
#endif
  webrtc::Thread* signaling_;
  bool server_candidates_;
  std::atomic<bool> gathered_{false};
  bool acknowledged_ = false;
  bool hello_sent_ = false;
};

bool Exchange(webrtc::scoped_refptr<webrtc::PeerConnectionInterface> connection,
              Observer& observer, webrtc::Thread* signaling,
              const std::string& offer_text, const char* answer_path
#ifdef ABSOR_RUST_BRIDGE
              , uint64_t bridge, bool api_signaling
#endif
              ) {
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
      // El laboratorio solo produce vídeo; una pista de audio sin fuente
      // debe quedar inactiva en la respuesta.
      const auto direction = transceiver->media_type() == webrtc::MediaType::VIDEO
          ? webrtc::RtpTransceiverDirection::kSendOnly
          : webrtc::RtpTransceiverDirection::kInactive;
      if (!transceiver->SetDirectionWithError(direction).ok()) directions_ok = false;
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
  std::this_thread::sleep_for(std::chrono::milliseconds(500));
  std::string final_sdp;
  signaling->BlockingCall([&] { connection->local_description()->ToString(&final_sdp); });
  if (final_sdp.size() > 262144) return false;
#ifdef ABSOR_RUST_BRIDGE
  // Vincular a las descripciones aplicadas: libwebrtc comprueba el certificado DTLS.
  std::string applied_remote;
  signaling->BlockingCall([&] { connection->remote_description()->ToString(&applied_remote); });
  observer.offer_fingerprint = Fingerprint(applied_remote);
  observer.answer_fingerprint = Fingerprint(final_sdp);
#endif
#ifdef ABSOR_RUST_BRIDGE
  if (api_signaling) {
    if (absor_bridge_answer(bridge, reinterpret_cast<const uint8_t*>(final_sdp.data()), final_sdp.size()) != 1) return false;
  } else
#endif
  {
    // Compatibilidad del diagnóstico anterior: solo esa variante escribe SDP.
    const auto temporary = std::string(answer_path) + ".part";
    { std::ofstream file(temporary, std::ios::binary); file << final_sdp; if (!file) return false; }
    std::error_code rename_error;
    std::filesystem::rename(temporary, answer_path, rename_error);
    if (rename_error) return false;
  }
  auto acknowledged = observer.acknowledged.get_future();
  return Wait(acknowledged);
}

int Run(const std::string& offer, const char* answer_path,
        const webrtc::PeerConnectionInterface::RTCConfiguration& configuration
#ifdef ABSOR_RUST_BRIDGE
        , uint64_t bridge, bool api_signaling
#endif
        ) {
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
  Observer observer(signaling.get(), !configuration.servers.empty()
#ifdef ABSOR_RUST_BRIDGE
      , bridge
#endif
      );
  auto connection_result = factory->CreatePeerConnectionOrError(
      configuration, webrtc::PeerConnectionDependencies(&observer));
  if (!connection_result.ok()) return 4;
  auto connection = connection_result.MoveValue();
#ifdef ABSOR_SYNTHETIC_VIDEO
#ifdef ABSOR_NATIVE_FIXTURE
  absor_lab::NativeFixtureVideo video;
  observer.on_authenticated = [&] { video.Start(factory.get(), connection.get(), bridge); };
#else
  absor_lab::SyntheticVideo video;
  observer.on_authenticated = [&] { video.Start(factory.get(), connection.get()); };
#endif
  int synthetic_frames = 0;
#endif
#ifdef ABSOR_RUST_BRIDGE
  observer.on_cut = [&] {
#ifdef ABSOR_SYNTHETIC_VIDEO
    synthetic_frames += video.Stop();
#endif
    observer.Detach();
    connection->Close();
  };
  signaling->BlockingCall([&] { observer.Poll(); });
#endif
  const bool exchanged = Exchange(connection, observer, signaling.get(), offer, answer_path
#ifdef ABSOR_RUST_BRIDGE
      , bridge, api_signaling
#endif
      );
  bool connected = false;
  bool authenticated = false;
  int completed_by = 0, channel_state = -1;
  signaling->BlockingCall([&] {
    completed_by = observer.completed_by;
    if (observer.channel) channel_state = static_cast<int>(observer.channel->state());
    connected = observer.connected;
    authenticated = observer.authenticated;
#ifdef ABSOR_SYNTHETIC_VIDEO
    synthetic_frames += video.Stop();
#endif
    observer.Detach();
    connection->Close();
  });
  connection = nullptr;
  factory = nullptr;
  signaling->Stop();
  network->Stop();
  if (!exchanged || !connected) {
    // Solo estados acotados; sin SDP, direcciones, mensajes ni claves.
    std::cerr << "native_exchange_failed exchanged=" << exchanged << " connected=" << connected
              << " authenticated=" << authenticated << " source=" << completed_by
              << " channel=" << channel_state << std::endl;
    return 5;
  }
#ifdef ABSOR_NATIVE_FIXTURE
  std::array<uint8_t, 1024> native_status{};
  int native_length = absor_bridge_native_status(bridge, native_status.data(), native_status.size());
  Json::Value native_report;
  Json::CharReaderBuilder native_parser;
  std::string native_error;
  std::istringstream native_json(native_length > 0
      ? std::string(reinterpret_cast<const char*>(native_status.data()), native_length) : "{}");
  if (!Json::parseFromStream(native_parser, native_json, &native_report, &native_error)) return 6;
#endif
  std::cout << "{\"dtlsConnected\":true,\"authenticated\":"
            << (authenticated ? "true" : "false")
#ifdef ABSOR_NATIVE_FIXTURE
            << ",\"captureStarted\":" << (synthetic_frames > 0 ? "true" : "false")
            << ",\"inputEnabled\":" << (native_report["inputs"].asUInt64() > 0 ? "true" : "false")
            << ",\"nativeFixture\":true,\"native\":" << Json::writeString(Json::StreamWriterBuilder(), native_report)
            << ",\"relayOnly\":"
#else
            << ",\"captureStarted\":false,\"inputEnabled\":false,\"relayOnly\":"
#endif
            << (configuration.type == webrtc::PeerConnectionInterface::kRelay ? "true" : "false")
#ifdef ABSOR_SYNTHETIC_VIDEO
#ifdef ABSOR_NATIVE_FIXTURE
            << ",\"nativeVideoFrames\":" << synthetic_frames
#else
            << ",\"syntheticVideoFrames\":" << synthetic_frames
#endif
#endif
#ifdef ABSOR_RUST_BRIDGE
            << ",\"rustAuthentication\":true,\"apiSignaling\":" << (api_signaling ? "true" : "false") << ",\"apiCutCode\":" << observer.bridge_cut
#endif
            << "}\n";
  return 0;
}
}  // namespace

int main(int argc, char** argv) {
#ifdef ABSOR_RUST_BRIDGE
  if (argc != 4 && argc != 5) return 64;
  const bool has_turn = argc == 5;
#else
  if (argc != 3 && argc != 4) { std::cerr << "Uso: channel_check <oferta.sdp> <respuesta.sdp> [turn-privado.json]\n"; return 64; }
  const bool has_turn = argc == 4;
#endif
  // Límite de la ABI de C: argc validado garantiza los elementos accesibles en argv.
#pragma clang unsafe_buffer_usage begin
  const std::span<char*> arguments(argv, static_cast<size_t>(argc));
#pragma clang unsafe_buffer_usage end
#ifdef ABSOR_RUST_BRIDGE
  // Ruta privada creada por el lanzador, sin secretos en argumentos o renderer.
  std::ifstream bridge_file(arguments[argc - 1], std::ios::binary | std::ios::ate);
  if (!bridge_file || bridge_file.tellg() < 0 || bridge_file.tellg() > 4096) return 65;
  bridge_file.seekg(0);
  const std::string bridge_config((std::istreambuf_iterator<char>(bridge_file)), std::istreambuf_iterator<char>());
  const auto bridge = absor_bridge_create(reinterpret_cast<const uint8_t*>(bridge_config.data()), bridge_config.size());
  if (!bridge) return 66;
  struct BridgeOwner { uint64_t id; ~BridgeOwner() { absor_bridge_close(id); } } owner{bridge};
  Json::Value bridge_value;
  Json::CharReaderBuilder bridge_parser;
  std::string bridge_errors;
  std::istringstream bridge_json(bridge_config);
  if (!Json::parseFromStream(bridge_parser, bridge_json, &bridge_value, &bridge_errors)) return 66;
  const bool api_signaling = bridge_value.get("apiSignaling", false).asBool();
  const auto api_deadline = std::chrono::steady_clock::now() + std::chrono::seconds(8);
  int state = 0;
  while ((state = absor_bridge_poll(bridge)) == 0 && std::chrono::steady_clock::now() < api_deadline) {
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  if (state != 1) return 67;
#endif
  std::string offer;
#ifdef ABSOR_RUST_BRIDGE
  if (!api_signaling)
#endif
  {
    std::ifstream file(arguments[1], std::ios::binary | std::ios::ate);
    if (!file || file.tellg() < 0 || file.tellg() > 262144) return 65;
    file.seekg(0);
    offer.assign(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
  }
  webrtc::PeerConnectionInterface::RTCConfiguration configuration;
  if (has_turn) {
    std::ifstream config_file(arguments[3], std::ios::binary | std::ios::ate);
    if (!config_file || config_file.tellg() < 0 || config_file.tellg() > 16384) return 65;
    config_file.seekg(0);
    Json::Value config;
    Json::CharReaderBuilder builder;
    builder["rejectDupKeys"] = true;
    builder["failIfExtra"] = true;
    std::string errors;
    if (!Json::parseFromStream(builder, config_file, &config, &errors) || !config.isObject() ||
        !config["iceServers"].isArray() || config["iceServers"].size() < 1 || config["iceServers"].size() > 8) return 65;
    for (const auto& server : config["iceServers"]) {
      if (!server.isObject() || !server["urls"].isArray() || server["urls"].size() < 1 ||
          server["urls"].size() > 8 || !server["username"].isString() || !server["credential"].isString() ||
          server["username"].asString().empty() || server["username"].asString().size() > 1024 ||
          server["credential"].asString().empty() || server["credential"].asString().size() > 1024) return 65;
      webrtc::PeerConnectionInterface::IceServer ice;
      for (const auto& value : server["urls"]) {
        if (!value.isString()) return 65;
        auto url = value.asString();
        if (url.size() > 512 || (!url.starts_with("turn:") && !url.starts_with("turns:") && !url.starts_with("stun:"))) return 65;
        ice.urls.push_back(std::move(url));
      }
      ice.username = server["username"].asString();
      ice.password = server["credential"].asString();
      configuration.servers.push_back(std::move(ice));
    }
    if (config.isMember("iceTransportPolicy") && config["iceTransportPolicy"] != "relay" && config["iceTransportPolicy"] != "all") return 65;
    configuration.type = config["iceTransportPolicy"] == "all"
        ? webrtc::PeerConnectionInterface::kAll : webrtc::PeerConnectionInterface::kRelay;
  }
#ifdef ABSOR_RUST_BRIDGE
  if (api_signaling) {
    if (has_turn) return 64;  // ICE solo procede de la API en esta variante.
    std::vector<uint8_t> bytes(262144);
    const auto offer_deadline = std::chrono::steady_clock::now() + std::chrono::seconds(12);
    int length = 0;
    while (std::chrono::steady_clock::now() < offer_deadline) {
      if (absor_bridge_poll(bridge) < 0) return 67;
      length = absor_bridge_offer(bridge, bytes.data(), bytes.size());
      if (length != 0) break;
      std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    if (length <= 0 || static_cast<size_t>(length) > bytes.size()) return 68;
    Json::Value payload;
    Json::CharReaderBuilder parser;
    std::string errors;
    std::istringstream encoded(std::string(reinterpret_cast<const char*>(bytes.data()), length));
    if (!Json::parseFromStream(parser, encoded, &payload, &errors) || !payload["offer"].isString() || !payload["iceServers"].isArray()) return 68;
    offer = payload["offer"].asString();
    for (const auto& server : payload["iceServers"]) {
      webrtc::PeerConnectionInterface::IceServer ice;
      for (const auto& url : server["urls"]) ice.urls.push_back(url.asString());
      if (server.isMember("username")) ice.username = server["username"].asString();
      if (server.isMember("credential")) ice.password = server["credential"].asString();
      configuration.servers.push_back(std::move(ice));
    }
  }
#endif
  if (!webrtc::InitializeSSL()) return 1;
  const int result = Run(offer, arguments[2], configuration
#ifdef ABSOR_RUST_BRIDGE
      , bridge, api_signaling
#endif
      );
  webrtc::CleanupSSL();
  return result;
}
