// Tiempo de PBKDF2-HMAC-SHA256 en WebCrypto, que es lo que usará el visor (D6)
;(async () => {
  const { iterations } = window.proto.config
  const times = []
  for (let i = 0; i < 3; i++) {
    const start = performance.now()
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('contraseña de prueba'), 'PBKDF2', false, ['deriveBits'])
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: crypto.getRandomValues(new Uint8Array(16)), iterations }, key, 256)
    times.push(Math.round(performance.now() - start))
  }
  window.proto.send('pbkdf2', times)
})()
