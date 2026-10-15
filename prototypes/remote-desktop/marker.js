// Movimiento continuo (para que la captura tenga cambios) y, con --tone, un tono a volumen bajo
const bar = document.getElementById('bar')
const clock = document.getElementById('clock')
function frame(t) {
  bar.style.left = `${((t / 8) % 140).toFixed(0)}px`
  clock.textContent = (t / 1000).toFixed(1)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

if (window.proto.config.tone) {
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = 440
  gain.gain.value = 0.03
  osc.connect(gain).connect(ctx.destination)
  osc.start()
}
