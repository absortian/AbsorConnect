import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({
  session: null as { email: string; token: string } | null,
  api: vi.fn(),
  auth: vi.fn(),
  store: vi.fn(),
  forget: vi.fn(),
  clear: vi.fn(),
  ssh: vi.fn()
}))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../ssh', () => ({ closeAllSsh: h.ssh }))
vi.mock('../apiClient', () => ({
  apiRequest: h.api,
  errorCode: () => 'test_error',
  ApiError: class extends Error {}
}))
vi.mock('../cloudStore', () => ({ clearConnections: h.clear, loadConnections: vi.fn() }))
vi.mock('../session', () => ({
  currentSession: () => h.session,
  loadSession: async () => h.session,
  authRequest: h.auth,
  deviceName: () => 'laboratorio',
  forgetSession: async () => {
    h.session = null
    h.forget()
  },
  storeSession: async (v: { email: string; token: string }) => {
    h.session = v
    h.store(v)
  }
}))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  h.session = { email: 'old@example.invalid', token: 'old-source' }
  h.auth.mockResolvedValue(undefined)
  h.api.mockResolvedValue({ token: 'new-source', user: { email: 'new@example.invalid' } })
})
it('cambiar de cuenta corta el host anterior antes de guardar el token nuevo y revoca la fuente antigua', async () => {
  const account = await import('../account'),
    exit = vi.fn(async () => {})
  account.setAccountExitHandler(exit)
  expect((await account.login('new@example.invalid', 'not-persisted')).ok).toBe(true)
  expect(exit).toHaveBeenCalledExactlyOnceWith('signed_out', 'old-source')
  expect(exit.mock.invocationCallOrder[0]).toBeLessThan(h.store.mock.invocationCallOrder[0])
  expect(h.api).toHaveBeenCalledWith('POST', '/api/auth/logout', { token: 'old-source' })
  expect(h.store).toHaveBeenCalledExactlyOnceWith({
    email: 'new@example.invalid',
    token: 'new-source'
  })
})
it('logout invalida un login todavía pendiente; su respuesta no restablece la cuenta', async () => {
  const account = await import('../account')
  let finish!: (v: unknown) => void
  h.api.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const pending = account.login('new@example.invalid', 'not-persisted')
  await account.logout()
  finish({ token: 'late-token', user: { email: 'new@example.invalid' } })
  expect((await pending).ok).toBe(false)
  expect(h.store).not.toHaveBeenCalled()
  expect(h.api).toHaveBeenCalledWith('POST', '/api/auth/logout', { token: 'late-token' })
})
it('logout durante el corte del host antiguo impide guardar la nueva sesión', async () => {
  const account = await import('../account')
  let finish!: () => void
  const waiting = new Promise<void>((resolve) => {
    finish = resolve
  })
  let calls = 0
  account.setAccountExitHandler(async () => {
    if (calls++ === 0) await waiting
  })
  const login = account.login('new@example.invalid', 'not-persisted')
  await vi.waitFor(() => expect(h.forget).toHaveBeenCalled())
  await account.logout()
  finish()
  expect((await login).ok).toBe(false)
  expect(h.store).not.toHaveBeenCalled()
})
it('cambiar contraseña de cuenta llama al corte nativo tras éxito sin borrar conexiones ni SSH', async () => {
  const account = await import('../account'),
    changed = vi.fn(async () => {})
  account.setAccountPasswordChangeHandler(changed)
  expect(await account.changePassword('old', 'new')).toEqual({ ok: true })
  expect(changed).toHaveBeenCalledOnce()
  expect(h.clear).not.toHaveBeenCalled()
  expect(h.ssh).not.toHaveBeenCalled()
  expect(h.forget).not.toHaveBeenCalled()
  h.auth.mockRejectedValueOnce(Error('rejected'))
  await account.changePassword('old', 'new')
  expect(changed).toHaveBeenCalledTimes(1)
})
