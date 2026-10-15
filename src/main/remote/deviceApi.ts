// Operaciones de ESTE PC en la API de control remoto (add-remote-desktop D4/D5): registrarse,
// consultar las solicitudes de sesión (que es también su señal de vida) y responderlas. Todas
// llevan la clave del equipo en X-Device-Key; sin ella, otra sesión de la misma cuenta podría
// hacerse pasar por este PC.
import { apiRequest } from '../cloud/apiClient'
import { RemoteFeatures } from './remoteAccessStore'

export type DevicePlatform = 'windows' | 'macos' | 'linux'

/** `remote_state` del equipo en la cuenta. */
export type RemoteState = 'disabled' | 'available' | 'missing_permissions' | 'unsupported' | 'busy'

export type RejectionReason =
  | 'wrong_password'
  | 'locked'
  | 'busy'
  | 'missing_permissions'
  | 'remote_disabled'
  | 'declined'
  | 'unsupported'

export interface DeviceInfo {
  name: string
  platform: DevicePlatform
  appVersion: string
  remote: { state: RemoteState; features: RemoteFeatures }
}

/** Solicitud de sesión sin responder: la oferta completa del controlador (vanilla ICE, D3). */
export interface PendingRequest {
  id: string
  controllerName: string
  offer: string
  createdAt: string
}

export interface DeviceCredentials {
  id: string
  key: string
}

export function devicePlatform(platform: NodeJS.Platform): DevicePlatform | null {
  return platform === 'win32'
    ? 'windows'
    : platform === 'darwin'
      ? 'macos'
      : platform === 'linux'
        ? 'linux'
        : null
}

export class DeviceApi {
  /** `token` da el token de la sesión de la cuenta en cada llamada (puede cambiar o caducar). */
  constructor(private readonly token: () => string | null) {}

  private request<T>(
    method: string,
    path: string,
    device: DeviceCredentials,
    body?: unknown
  ): Promise<T> {
    return apiRequest<T>(method, path, {
      token: this.token() ?? undefined,
      body,
      headers: { 'X-Device-Key': device.key }
    })
  }

  /** Alta o actualización del equipo (`device_taken`, `device_key_invalid`, `device_invalid`). */
  async register(device: DeviceCredentials, info: DeviceInfo): Promise<void> {
    await this.request('PUT', `/api/devices/${device.id}`, device, info)
  }

  async remove(device: DeviceCredentials): Promise<void> {
    await this.request('DELETE', `/api/devices/${device.id}`, device)
  }

  /** Solicitudes pendientes; la consulta cuenta como señal de vida (en línea 30 s). */
  async poll(device: DeviceCredentials): Promise<PendingRequest[]> {
    const data = await this.request<{ requests?: PendingRequest[] }>(
      'GET',
      `/api/devices/${device.id}/remote-requests`,
      device
    )
    return Array.isArray(data?.requests) ? data.requests : []
  }

  async answer(device: DeviceCredentials, requestId: string, answer: string): Promise<void> {
    await this.request('PUT', `/api/remote-requests/${requestId}/answer`, device, { answer })
  }

  async reject(
    device: DeviceCredentials,
    requestId: string,
    reason: RejectionReason,
    retryAfter?: number
  ): Promise<void> {
    await this.request('PUT', `/api/remote-requests/${requestId}/answer`, device, {
      rejected: retryAfter === undefined ? { reason } : { reason, retryAfter }
    })
  }
}
