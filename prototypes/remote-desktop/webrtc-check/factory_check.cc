// Solo comprueba la inicialización de la biblioteca; no anuncia soporte del agente.
#include <iostream>
#include <utility>

#include "api/create_modular_peer_connection_factory.h"
#include "api/environment/environment_factory.h"
#include "api/peer_connection_interface.h"
#include "rtc_base/ssl_adapter.h"
#include "rtc_base/thread.h"

int main() {
  if (!webrtc::InitializeSSL()) return 1;
  int result = 0;
  {
    auto network = webrtc::Thread::CreateWithSocketServer();
    auto signaling = webrtc::Thread::Create();
    if (!network->Start() || !signaling->Start()) return 2;
    webrtc::PeerConnectionFactoryDependencies dependencies;
    dependencies.env = webrtc::CreateEnvironment();
    dependencies.network_thread = network.get();
    dependencies.signaling_thread = signaling.get();
    auto factory = webrtc::CreateModularPeerConnectionFactory(std::move(dependencies));
    result = factory ? 0 : 3;
    factory = nullptr;
    signaling->Stop();
    network->Stop();
  }
  webrtc::CleanupSSL();
  if (!result) {
    std::cout << "{\"factoryCreated\":true,\"mediaEnabled\":false,"
                 "\"transportTested\":false,\"readyForUnattended\":false}\n";
  }
  return result;
}
