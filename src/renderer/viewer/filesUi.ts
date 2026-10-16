// Ficheros y portapapeles en la interfaz del visor (add-remote-desktop D11, tarea 6.5): botones de la
// barra, soltar ficheros sobre la ventana, el explorador de carpetas del PC y la lista de
// transferencias con su progreso.
import type { FsEntry } from '../../shared/remote/transfer'
import type { ViewerTexts } from './texts'
import { TransferView, ViewerTransfers } from './transfers'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

/** En Windows, la carpeta "Este equipo" con las unidades (fileTransfer.ts). */
const DRIVES_PATH = '::drives'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

/** Une una carpeta del PC con un nombre, con el separador del propio PC. */
export function joinRemote(dir: string, name: string): string {
  if (dir === DRIVES_PATH) return name
  const separator = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return dir.endsWith(separator) ? dir + name : dir + separator + name
}

export interface FilesUi {
  /** Funciones que el PC permite en esta sesión (mensaje `features`). */
  setFeatures(features: { clipboard: boolean; files: boolean }): void
  /** Sin sesión (cerrada o fallida): se ocultan los botones y se deja de vigilar el portapapeles. */
  disable(): void
  /** El explorador está abierto: el teclado no va al PC. */
  readonly browsing: boolean
}

export function setupFilesUi(options: {
  t: ViewerTexts
  pcName: string
  transfers: ViewerTransfers
  connected: () => boolean
  focusVideo: () => void
}): { ui: FilesUi; render: (view: TransferView) => void } {
  const { t, transfers } = options
  const clipboardButton = $<HTMLButtonElement>('clipboard')
  const sendButton = $<HTMLButtonElement>('send-files')
  const downloadButton = $<HTMLButtonElement>('download')
  const fileInput = $<HTMLInputElement>('file-input')
  const drop = $('drop')
  const browser = $('browser')
  const browserPath = $<HTMLInputElement>('browser-path')
  const browserUp = $<HTMLButtonElement>('browser-up')
  const browserList = $('browser-list')
  const browserMessage = $('browser-message')
  const panel = $('transfers')
  const list = $('transfer-list')

  sendButton.textContent = t.sendFiles
  downloadButton.textContent = t.download
  $('drop-text').textContent = t.dropHere(options.pcName)
  browserUp.title = t.up
  $('browser-close').title = t.close
  $('transfers-title').textContent = t.transfers
  $('transfers-clear').textContent = t.clearFinished

  let filesAllowed = false
  let currentPath = ''
  let parentPath: string | null = null

  const renderClipboard = (): void => {
    clipboardButton.textContent = transfers.clipboardPaused ? t.clipboardPaused : t.clipboardOn
    clipboardButton.classList.toggle('paused', transfers.clipboardPaused)
  }

  // --- Portapapeles ------------------------------------------------------------------------
  clipboardButton.addEventListener('click', () => {
    transfers.setClipboardPaused(!transfers.clipboardPaused)
    renderClipboard()
    options.focusVideo()
  })

  // --- Enviar: botón y soltar sobre la ventana ------------------------------------------------
  sendButton.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) transfers.upload([...fileInput.files])
    fileInput.value = ''
    options.focusVideo()
  })
  const carriesFiles = (event: DragEvent): boolean =>
    filesAllowed && options.connected() && !!event.dataTransfer?.types.includes('Files')
  let dragDepth = 0
  window.addEventListener('dragenter', (event) => {
    if (!carriesFiles(event)) return
    dragDepth++
    drop.hidden = false
  })
  window.addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    event.dataTransfer!.dropEffect = 'copy'
  })
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) drop.hidden = true
  })
  window.addEventListener('drop', (event) => {
    event.preventDefault()
    dragDepth = 0
    drop.hidden = true
    if (!filesAllowed || !options.connected()) return
    const files = [...(event.dataTransfer?.files ?? [])]
    if (files.length) transfers.upload(files)
  })

  // --- Descargar: explorador de carpetas del PC ----------------------------------------------
  const entryRow = (entry: FsEntry): HTMLLIElement => {
    const row = document.createElement('li')
    row.className = entry.dir ? 'dir' : 'file'
    row.tabIndex = 0
    const icon = document.createElement('span')
    icon.className = 'icon'
    icon.textContent = entry.dir ? '📁' : '📄'
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = entry.name
    const size = document.createElement('span')
    size.className = 'size'
    size.textContent = entry.dir ? '' : formatBytes(entry.size)
    row.append(icon, name, size)
    const open = (): void => {
      const path = joinRemote(currentPath, entry.name)
      if (entry.dir) void openFolder(path)
      else transfers.download(path, entry.name, entry.size)
    }
    row.addEventListener('click', open)
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') open()
    })
    return row
  }

  async function openFolder(path: string): Promise<void> {
    browserMessage.textContent = t.loading
    browserMessage.classList.remove('error')
    const listing = await transfers.list(path)
    if (!listing) {
      browserMessage.textContent = t.transferError('connection_lost')
      browserMessage.classList.add('error')
      return
    }
    currentPath = listing.path
    parentPath = listing.parent
    browserPath.value = listing.path === DRIVES_PATH ? t.drives : listing.path
    browserUp.disabled = listing.parent === null
    browserList.replaceChildren(...listing.entries.map(entryRow))
    if (listing.error) {
      browserMessage.textContent = t.transferError(listing.error)
      browserMessage.classList.add('error')
    } else {
      browserMessage.textContent =
        listing.entries.length === 0 ? t.folderEmpty : listing.truncated ? t.truncated : ''
    }
  }

  const closeBrowser = (): void => {
    browser.hidden = true
    options.focusVideo()
  }
  downloadButton.addEventListener('click', () => {
    if (!browser.hidden) return closeBrowser()
    browser.hidden = false
    void openFolder(currentPath)
  })
  browserUp.addEventListener('click', () => {
    if (parentPath !== null) void openFolder(parentPath)
  })
  browserPath.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void openFolder(browserPath.value.trim())
    if (event.key === 'Escape') closeBrowser()
  })
  $('browser-close').addEventListener('click', closeBrowser)

  // --- Lista de transferencias ----------------------------------------------------------------
  const rows = new Map<number, HTMLLIElement>()
  const finished = (status: TransferView['status']): boolean =>
    status === 'done' || status === 'failed' || status === 'cancelled'

  function render(view: TransferView): void {
    panel.hidden = false
    let row = rows.get(view.id)
    if (!row) {
      row = document.createElement('li')
      row.innerHTML =
        '<div class="line"><span class="arrow"></span><span class="name"></span><span class="actions"></span></div>' +
        '<div class="bar"><div class="fill"></div></div><div class="state"></div>'
      row.querySelector('.arrow')!.textContent = view.direction === 'up' ? '↑' : '↓'
      row.querySelector('.name')!.textContent = view.name
      list.prepend(row)
      rows.set(view.id, row)
    }
    const percent = view.size > 0 ? Math.min(100, Math.floor((view.bytes / view.size) * 100)) : 100
    row.className = view.status
    ;(row.querySelector('.fill') as HTMLElement).style.width =
      `${view.status === 'done' ? 100 : percent}%`
    row.querySelector('.state')!.textContent =
      view.status === 'waiting'
        ? t.queued
        : view.status === 'running'
          ? `${percent} % · ${formatBytes(view.bytes)} / ${formatBytes(view.size)}`
          : view.status === 'done'
            ? view.direction === 'up'
              ? t.sentAs(view.result ?? view.name)
              : `${t.saved}: ${view.result ?? ''}`
            : view.status === 'cancelled'
              ? t.cancelled
              : t.transferError(view.error ?? 'io')
    const actions = row.querySelector('.actions')!
    actions.replaceChildren()
    if (!finished(view.status)) {
      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.textContent = t.cancel
      cancel.addEventListener('click', () => transfers.cancel(view.id))
      actions.append(cancel)
    } else if (view.status === 'done' && view.direction === 'down' && view.result) {
      const show = document.createElement('button')
      show.type = 'button'
      show.textContent = t.showInFolder
      const path = view.result
      show.addEventListener('click', () => window.absorViewer.showInFolder(path))
      actions.append(show)
    }
  }

  $('transfers-clear').addEventListener('click', () => {
    for (const [id, row] of rows) {
      if (['done', 'failed', 'cancelled'].includes(row.className)) {
        row.remove()
        rows.delete(id)
      }
    }
    if (rows.size === 0) panel.hidden = true
  })

  const ui: FilesUi = {
    setFeatures(features) {
      filesAllowed = features.files
      sendButton.hidden = !features.files
      downloadButton.hidden = !features.files
      if (!features.files) browser.hidden = true
      clipboardButton.hidden = !features.clipboard
      transfers.setClipboardEnabled(features.clipboard)
      renderClipboard()
    },
    disable() {
      filesAllowed = false
      sendButton.hidden = true
      downloadButton.hidden = true
      clipboardButton.hidden = true
      browser.hidden = true
      transfers.setClipboardEnabled(false)
    },
    get browsing() {
      return !browser.hidden
    }
  }
  return { ui, render }
}
