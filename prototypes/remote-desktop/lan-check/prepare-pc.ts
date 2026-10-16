// Prepara la carpeta de datos de una app que hará de PC de prueba arrancada a mano (por ejemplo, en
// la máquina virtual de Windows): sesión de la cuenta de prueba, contraseña del PC y control remoto
// activado. Se ejecuta con Node (o Electron como Node) y luego se copia la carpeta al otro equipo:
//
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron prototypes/remote-desktop/lan-check/out/prepare-pc.cjs \
//     --api=http://<ip del backend>:8020 --name="PC de prueba Windows" --dir=<carpeta de datos>
//
// La app se arranca después con --user-data-dir=<esa carpeta> y ABSOR_CONNECT_API_URL apuntando al
// mismo backend. La K va sin cifrar (como en pc.ts): solo para pruebas.
import * as fs from 'fs'
import * as path from 'path'
import { RemoteAccessStore } from '../../../src/main/remote/remoteAccessStore'
import { createPlaintextBox } from '../../../src/main/remote/secretBox'
import { args, login, PC_PASSWORD, TEST_EMAIL } from './common'

async function main(): Promise<void> {
  const name = args.name
  const dir = args.dir
  if (!name || !dir) throw new Error('Faltan --name y --dir')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const token = await login(name)
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ email: TEST_EMAIL, token, encrypted: false }))
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: true, openAtLogin: false })
  )
  const store = new RemoteAccessStore(path.join(dir, 'remote-access.json'), createPlaintextBox(), name)
  await store.bindToAccount(TEST_EMAIL)
  await store.setPassword(PC_PASSWORD)
  await store.setDeviceName(name)
  await store.setEnabled(true)
  console.log(`Listo: ${dir} (contraseña del PC: la de las pruebas)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
