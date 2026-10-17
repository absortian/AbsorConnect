// Espera a que un PC de prueba (pc.ts) aparezca disponible en la cuenta y escribe la URL de su sonda
// (la IP y el puerto de su nombre). La usa package-check para controlar desde el móvil un PC de otro
// equipo. Se ejecuta con Node:
//
//   node prototypes/remote-desktop/lan-check/out/wait-pc.cjs --api=http://127.0.0.1:8020 \
//     --prefix="PC de prueba macOS" [--minutes=180]
import { api, args, login, PC_PREFIX, sleep } from './common'

async function run(): Promise<void> {
  const prefix = args.prefix ?? PC_PREFIX
  const deadline = Date.now() + Number(args.minutes ?? 180) * 60_000
  const token = await login('Espera de PC de prueba')
  while (Date.now() < deadline) {
    const { data } = await api('GET', '/api/devices', token).catch(() => ({ data: null }))
    for (const device of data?.devices ?? []) {
      const address = device.name.match(/@([\d.]+:\d+)$/)?.[1]
      if (!device.online || device.remote?.state !== 'available' || !device.name.startsWith(prefix) || !address) continue
      const probe = `http://${address}`
      const ok = await fetch(`${probe}/state`, { signal: AbortSignal.timeout(5000) }).then((r) => r.ok).catch(() => false)
      if (ok) {
        console.log(probe)
        return
      }
    }
    await sleep(3000)
  }
  throw new Error(`No aparece ningún «${prefix} …» disponible`)
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
