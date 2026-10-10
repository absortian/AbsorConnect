import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { S3Connection } from '../../../shared/types'
import { Folder, File, ArrowLeft, RefreshCw, Trash2, HardDrive, Download, FolderPlus, FolderDown } from 'lucide-react'
import { useTransferQueue } from '../context/TransferQueueContext'
import { formatFileSize } from '../../../shared/utils'

interface S3ExplorerProps {
  connection: S3Connection
  localCurrentPath?: string
  onLocationChange?: (bucket: string, prefix: string) => void
}

interface S3ContextMenu {
  x: number
  y: number
  key: string
  isFolder: boolean
}

const CONTEXT_MENU_WIDTH = 200
const CONTEXT_MENU_GUTTER = 4

  export default function S3Explorer({ connection, localCurrentPath, onLocationChange }: S3ExplorerProps) {
  const { t } = useTranslation()
  const [currentBucket, setCurrentBucket] = useState(connection.bucket || '')
  const [currentPrefix, setCurrentPrefix] = useState('')
  const [buckets, setBuckets] = useState<string[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [files, setFiles] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [contextMenu, setContextMenu] = useState<S3ContextMenu | null>(null)
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const newFolderRef = useRef<HTMLInputElement>(null)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [lastClickedItem, setLastClickedItem] = useState<string | null>(null)
  const { addJob, lastJobUpdate } = useTransferQueue()

  const loadObjects = async (bucket: string, prefix: string) => {
    setLoading(true)
    setError('')
    try {
      if (!bucket) {
        // List buckets instead
        const bucketList = await window.api.listBuckets(connection)
        setBuckets(bucketList)
        setFolders([])
        setFiles([])
      } else {
        const result = await window.api.listObjects(connection, bucket, prefix)
        setFolders(result.folders)
        setFiles(result.files)
      }
      setCurrentBucket(bucket)
      setCurrentPrefix(prefix)
      setSelectedItems(new Set())
      setLastClickedItem(null)
      if (onLocationChange) onLocationChange(bucket, prefix)
    } catch (err: any) {
      setError(err.message || t('s3.failedToListObjects'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadObjects(connection.bucket || '', '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection])

  useEffect(() => {
    if (lastJobUpdate > 0 && currentBucket) {
      loadObjects(currentBucket, currentPrefix)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastJobUpdate])

  // Close context menu on click or when the other panel opens its menu
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    const handleOtherMenu = (e: Event) => {
      if ((e as CustomEvent).detail !== 's3') setContextMenu(null)
    }
    const handleOtherClick = (e: Event) => {
      if ((e as CustomEvent).detail !== 's3') setContextMenu(null)
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('contextmenu-open', handleOtherMenu)
    window.addEventListener('explorer-panel-click', handleOtherClick)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('contextmenu-open', handleOtherMenu)
      window.removeEventListener('explorer-panel-click', handleOtherClick)
    }
  }, [])

  // Focus new folder input when shown
  useEffect(() => {
    if (showNewFolderInput && newFolderRef.current) {
      newFolderRef.current.focus()
    }
  }, [showNewFolderInput])

  // Build flat ordered list of all item IDs for shift-click range selection
  const allItemIds = [
    ...folders.map(f => `folder:${f}`),
    ...files.map(f => `file:${f.key}`)
  ]

  const handleItemClick = (e: React.MouseEvent, itemId: string) => {
    e.stopPropagation()
    setContextMenu(null)
    window.dispatchEvent(new CustomEvent('explorer-panel-click', { detail: 's3' }))
    if (e.metaKey || e.ctrlKey) {
      setSelectedItems(prev => {
        const next = new Set(prev)
        if (next.has(itemId)) next.delete(itemId)
        else next.add(itemId)
        return next
      })
      setLastClickedItem(itemId)
    } else if (e.shiftKey && lastClickedItem) {
      const startIdx = allItemIds.indexOf(lastClickedItem)
      const endIdx = allItemIds.indexOf(itemId)
      if (startIdx !== -1 && endIdx !== -1) {
        const from = Math.min(startIdx, endIdx)
        const to = Math.max(startIdx, endIdx)
        const range = allItemIds.slice(from, to + 1)
        setSelectedItems(prev => {
          const next = new Set(prev)
          range.forEach(id => next.add(id))
          return next
        })
      }
    } else {
      setSelectedItems(new Set([itemId]))
      setLastClickedItem(itemId)
    }
  }

  const handleBackgroundClick = (e: React.MouseEvent) => {
    setContextMenu(null)
    window.dispatchEvent(new CustomEvent('explorer-panel-click', { detail: 's3' }))
    if (e.target === e.currentTarget) {
      setSelectedItems(new Set())
      setLastClickedItem(null)
    }
  }

  const navigateUp = () => {
    if (!currentBucket) return
    if (!currentPrefix && !connection.bucket) {
      // Go back to bucket list
      loadObjects('', '')
      return
    }
    if (!currentPrefix) return
    const parts = currentPrefix.split('/').filter(Boolean)
    parts.pop()
    const newPrefix = parts.length > 0 ? parts.join('/') + '/' : ''
    loadObjects(currentBucket, newPrefix)
  }

  const navigateTo = (folderPath: string) => {
    loadObjects(currentBucket, folderPath)
  }

  const handleDelete = async (keys: { key: string; isFolder: boolean }[]) => {
    if (!currentBucket || keys.length === 0) return
    const msg = keys.length === 1
      ? t('s3.confirmDelete', { name: keys[0].isFolder ? keys[0].key.split('/').filter(Boolean).pop() + '/' : keys[0].key.split('/').pop() })
      : t('s3.confirmDeleteMultiple', { count: keys.length })
    if (!window.confirm(msg)) return
    try {
      setLoading(true)
      for (const item of keys) {
        if (item.isFolder) {
          await window.api.deleteFolder(connection, currentBucket, item.key)
        } else {
          await window.api.deleteObject(connection, currentBucket, item.key)
        }
      }
      loadObjects(currentBucket, currentPrefix)
    } catch (err: any) {
      alert(err.message || t('s3.failedToDelete'))
    } finally {
      setLoading(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!currentBucket) return

    // Internal Drag and Drop — multi-file from LocalExplorer
    const multiFilePaths = e.dataTransfer.getData('application/x-local-files')
    if (multiFilePaths) {
      try {
        const paths: string[] = JSON.parse(multiFilePaths)
        for (const p of paths) {
          const fileName = p.split(/\\|\//).pop() || 'file'
          const key = `${currentPrefix}${fileName}`
          addJob({
            type: 'upload',
            sourcePath: p,
            destPath: key,
            fileName,
            connectionId: connection.id,
            bucket: currentBucket
          })
        }
      } catch { /* fall through */ }
      return
    }

    // Internal Drag and Drop — single file from LocalExplorer
    const localFilePath = e.dataTransfer.getData('application/x-local-file')
    if (localFilePath) {
      const fileName = localFilePath.split(/\\|\//).pop() || 'file'
      const key = `${currentPrefix}${fileName}`
      addJob({
        type: 'upload',
        sourcePath: localFilePath,
        destPath: key,
        fileName,
        connectionId: connection.id,
        bucket: currentBucket
      })
      return
    }

    // External OS Drop
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    for (const file of files) {
      // File.path no existe desde Electron 32: la ruta se obtiene con webUtils desde el preload
      const localPath = window.api.getPathForFile(file)
      if (!localPath) continue
      const key = `${currentPrefix}${file.name}`
      addJob({
        type: 'upload',
        sourcePath: localPath,
        destPath: key,
        fileName: file.name,
        connectionId: connection.id,
        bucket: currentBucket
      })
    }
  }

  const handleDownload = async (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentBucket) return
    const fileName = key.split('/').pop() || 'download'
    const savePath = await window.api.showSaveDialog(fileName)
    if (!savePath) return // User canceled

    addJob({
      type: 'download',
      sourcePath: key,
      destPath: savePath,
      fileName,
      connectionId: connection.id,
      bucket: currentBucket
    })
  }

  const handleDownloadToLocal = (keys: string[]) => {
    if (!currentBucket || !localCurrentPath) return
    for (const key of keys) {
      const fileName = key.split('/').pop() || 'download'
      const separator = localCurrentPath.includes('\\') ? '\\' : '/'
      const destPath = localCurrentPath.endsWith(separator)
        ? `${localCurrentPath}${fileName}`
        : `${localCurrentPath}${separator}${fileName}`
      addJob({
        type: 'download',
        sourcePath: key,
        destPath,
        fileName,
        connectionId: connection.id,
        bucket: currentBucket
      })
    }
  }

  const handleS3ContextMenu = (e: React.MouseEvent, key: string, isFolder: boolean) => {
    e.preventDefault()
    e.stopPropagation()
    // Ensure right-clicked item is selected
    const itemId = isFolder ? `folder:${key}` : `file:${key}`
    if (!selectedItems.has(itemId)) {
      setSelectedItems(new Set([itemId]))
      setLastClickedItem(itemId)
    }
    // Calculate menu height based on items: files get 3 options, folders get 1
    const optionCount = isFolder ? 1 : 3
    const menuHeight = optionCount * 36 + 12
    const x = Math.min(e.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_GUTTER)
    const y = Math.min(e.clientY - 60, window.innerHeight - menuHeight - CONTEXT_MENU_GUTTER)
    window.dispatchEvent(new CustomEvent('contextmenu-open', { detail: 's3' }))
    setContextMenu({ x, y: Math.max(CONTEXT_MENU_GUTTER, y), key, isFolder })
  }

  // Helpers to get selected items for batch operations
  const getSelectedFileKeys = () => {
    return [...selectedItems]
      .filter(id => id.startsWith('file:'))
      .map(id => id.slice(5))
  }

  const getSelectedDeleteItems = () => {
    return [...selectedItems].map(id => {
      if (id.startsWith('folder:')) return { key: id.slice(7), isFolder: true }
      return { key: id.slice(5), isFolder: false }
    })
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !currentBucket) return
    try {
      const key = `${currentPrefix}${newFolderName.trim()}`
      await window.api.createFolder(connection, currentBucket, key)
      setNewFolderName('')
      setShowNewFolderInput(false)
      loadObjects(currentBucket, currentPrefix)
    } catch (err: any) {
      alert(err.message || t('s3.failedToCreateFolder'))
    }
  }

  const handleDragStart = (e: React.DragEvent, key: string, bucket: string) => {
    // If dragging a selected item with multi-selection, drag all selected files
    const selectedFileKeys = getSelectedFileKeys()
    if (selectedFileKeys.length > 1 && selectedItems.has(`file:${key}`)) {
      const payload = JSON.stringify({ keys: selectedFileKeys, bucket, connectionId: connection.id })
      e.dataTransfer.setData('application/x-s3-files', payload)
      // Also set single for backwards compat
      e.dataTransfer.setData('application/x-s3-file', JSON.stringify({ key: selectedFileKeys[0], bucket, connectionId: connection.id }))
    } else {
      const payload = JSON.stringify({ key, bucket, connectionId: connection.id })
      e.dataTransfer.setData('application/x-s3-file', payload)
    }
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div 
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Action Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: '48px', background: 'var(--bg-glass)', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button className="btn-icon" onClick={navigateUp} disabled={!currentBucket && !currentPrefix || loading}>
            <ArrowLeft size={18} />
          </button>
          <button className="btn-icon" onClick={() => loadObjects(currentBucket, currentPrefix)} disabled={loading}>
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
          </button>
          {currentBucket && (
            <button className="btn-icon" title={t('s3.newFolder')} onClick={() => setShowNewFolderInput(true)}>
              <FolderPlus size={18} />
            </button>
          )}
          <span style={{ marginLeft: '12px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            <HardDrive size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
            {currentBucket || t('s3.allBuckets')} {currentBucket && <span style={{ opacity: 0.5 }}>/ {currentPrefix}</span>}
          </span>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '4px', marginBottom: '16px', fontSize: '0.9rem' }}>
          {error}
        </div>
      )}

      {/* Grid view */}
      <div className="glass-panel" style={{ flex: 1, overflowY: 'auto', padding: '12px', borderRadius: 0, border: 'none' }}
           onClick={handleBackgroundClick}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>{t('s3.loading')}</div>
        ) : !currentBucket ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {buckets.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>{t('s3.noBuckets')}</div>}
            {buckets.map(bucket => (
              <li key={bucket} onClick={() => loadObjects(bucket, '')} style={itemStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <HardDrive size={18} color="var(--accent-primary)" />
                  <span style={{ fontWeight: 500 }}>{bucket}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : folders.length === 0 && files.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>{t('s3.emptyFolder')}</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {showNewFolderInput && (
              <li style={{ ...itemStyle, gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                  <FolderPlus size={18} color="var(--accent-primary)" />
                  <input
                    ref={newFolderRef}
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateFolder()
                      if (e.key === 'Escape') { setShowNewFolderInput(false); setNewFolderName('') }
                    }}
                    onBlur={() => { setShowNewFolderInput(false); setNewFolderName('') }}
                    placeholder={t('s3.folderNamePlaceholder')}
                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--accent-primary)', padding: '4px 8px', borderRadius: '4px', color: 'white', outline: 'none', flex: 1, fontSize: '0.9rem' }}
                  />
                </div>
              </li>
            )}
            {folders.map(folder => {
              const name = folder.split('/').filter(Boolean).pop() + '/'
              const folderId = `folder:${folder}`
              const isSelected = selectedItems.has(folderId)
              return (
                <li key={folder}
                    onClick={(e) => handleItemClick(e, folderId)}
                    onDoubleClick={() => navigateTo(folder)}
                    style={{ ...itemStyle, ...(isSelected ? selectedStyle : {}) }}
                    onContextMenu={(e) => handleS3ContextMenu(e, folder, true)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Folder size={18} color={isSelected ? 'var(--accent-primary)' : 'var(--accent-primary)'} />
                    <span>{name}</span>
                  </div>
                </li>
              )
            })}
            {files.map(file => {
              const name = file.key.split('/').pop()
              const fileId = `file:${file.key}`
              const isSelected = selectedItems.has(fileId)
              return (
                <li 
                  key={file.key} 
                  style={{ ...itemStyle, ...(isSelected ? selectedStyle : {}) }}
                  className="file-item"
                  draggable
                  onDragStart={(e) => handleDragStart(e, file.key, currentBucket)}
                  onClick={(e) => handleItemClick(e, fileId)}
                  onContextMenu={(e) => handleS3ContextMenu(e, file.key, false)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <File size={18} color={isSelected ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
                    <span style={{ cursor: 'grab' }}>{name}</span>
                  </div>
                  <div className="file-actions" style={{ display: 'flex', gap: '8px' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {formatFileSize(file.size)}
                    </span>
                    <button className="btn-icon" title={t('s3.download')} onClick={(e) => handleDownload(file.key, e)}>
                      <Download size={14} />
                    </button>
                    <button className="btn-icon" title={t('s3.delete')} onClick={(e) => { e.stopPropagation(); handleDelete([{ key: file.key, isFolder: false }]); }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .file-item .file-actions button { opacity: 0; }
        .file-item:hover .file-actions button { opacity: 1; }
        .s3-context-menu-item { display: flex; align-items: center; justify-content: flex-start; gap: 8px; width: 100%; padding: 8px 12px; background: transparent; border: none; color: var(--text-primary); cursor: pointer; text-align: left; border-radius: 4px; font-size: 0.85rem; font-weight: 500; transition: background var(--transition-fast); white-space: nowrap; }
        .s3-context-menu-item:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
        .s3-context-menu-item:disabled { color: var(--text-muted); opacity: 0.55; cursor: not-allowed; }
        .s3-context-menu-item.danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
      `}</style>

      {/* S3 Context Menu */}
      {contextMenu && (
        <div 
          style={{ 
            position: 'fixed', 
            top: `${contextMenu.y}px`, 
            left: `${contextMenu.x}px`, 
            background: 'rgba(39, 39, 42, 0.96)', 
            border: '1px solid rgba(255, 255, 255, 0.12)', 
            boxShadow: '0 18px 40px rgba(0, 0, 0, 0.35)', 
            borderRadius: 'var(--radius-md)', 
            padding: '6px',
            zIndex: 200,
            minWidth: '200px',
            overflow: 'hidden',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {!contextMenu.isFolder && (
            <>
              <button 
                className="s3-context-menu-item"
                onClick={(e) => { setContextMenu(null); handleDownload(contextMenu.key, e) }}
              >
                <Download size={16} />
                {t('s3.downloadSaveAs')}
              </button>
              <button 
                className="s3-context-menu-item"
                disabled={!localCurrentPath}
                onClick={() => {
                  const keys = getSelectedFileKeys()
                  handleDownloadToLocal(keys.length > 0 ? keys : [contextMenu.key])
                  setContextMenu(null)
                }}
              >
                <FolderDown size={16} />
                {selectedItems.size > 1 ? t('s3.downloadItemsToLocal', { count: selectedItems.size }) : t('s3.downloadToLocal')}
              </button>
            </>
          )}
          <button 
            className="s3-context-menu-item danger"
            onClick={() => {
              const items = getSelectedDeleteItems()
              handleDelete(items.length > 0 ? items : [{ key: contextMenu.key, isFolder: contextMenu.isFolder }])
              setContextMenu(null)
            }}
          >
            <Trash2 size={16} />
            {selectedItems.size > 1 ? t('s3.deleteItems', { count: selectedItems.size }) : t('s3.delete')}
          </button>
        </div>
      )}
    </div>
  )
}

const itemStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '12px 16px', borderBottom: '1px solid var(--border-light)',
  cursor: 'pointer', transition: 'background var(--transition-fast), border-color var(--transition-fast)',
}

const selectedStyle: React.CSSProperties = {
  background: 'rgba(99, 102, 241, 0.15)',
  borderBottom: '1px solid rgba(99, 102, 241, 0.25)',
}
