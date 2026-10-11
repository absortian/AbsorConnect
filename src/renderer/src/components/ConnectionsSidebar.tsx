import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, HardDrive, Server, Trash2, X, FolderPlus, Folder, ChevronDown, ChevronRight, Pencil, SquareTerminal, AlertTriangle } from 'lucide-react'
import { Connection, ConnectionDraft, ConnectionEntry, ConnectionType, FolderEntry, SshAuthMethod, SshConnection } from '../../../shared/types'
import { DEFAULT_SSH_PORT, SECRET_FIELDS } from '../../../shared/connections'
import { cloudErrorCode, cloudErrorMessage } from '../cloudErrors'

// Aviso sobre el último guardado: otro equipo guardó antes (conflict) o falló la petición
type SaveNotice = { kind: 'conflict' } | { kind: 'error'; code: string }

export default function ConnectionsSidebar({ isOpen, onSelectConnection, onOpenTerminal }: { isOpen: boolean, onSelectConnection: (conn: Connection) => void, onOpenTerminal: (conn: SshConnection) => void }) {
  const { t } = useTranslation()
  const [connections, setConnections] = useState<ConnectionEntry[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const [notice, setNotice] = useState<SaveNotice | null>(null)

  // Lista de la cuenta (el proceso principal la tiene en caché) y cambios desde otros equipos:
  // al volver a la ventana o cuando un guardado se rechaza por conflicto
  useEffect(() => {
    window.api.getConnections().then(setConnections).catch((error) => setNotice({ kind: 'error', code: cloudErrorCode(error) }))
    return window.api.onConnectionsChanged(async ({ conflict }) => {
      try {
        setConnections(await window.api.getConnections())
        if (conflict) setNotice({ kind: 'conflict' })
      } catch {
        // Sesión caducada: la puerta de sesión ya vuelve a la pantalla de acceso
      }
    })
  }, [])

  if (!isOpen) return null

  // Guarda la lista entera en la cuenta. Si falla, devuelve false y la lista vuelve a la
  // guardada (en un conflicto ya llega recargada por connections-changed, con su aviso)
  const persist = async (updated: ConnectionEntry[]): Promise<boolean> => {
    setConnections(updated)
    setNotice(null)
    try {
      await window.api.saveConnections(updated)
      // La lista que ha confirmado el servicio. El proceso principal pone en fila lecturas y
      // escrituras, así que una carga anterior aún en curso no puede pisar este cambio.
      setConnections(await window.api.getConnections())
      return true
    } catch (error) {
      const code = cloudErrorCode(error)
      if (code !== 'connections_conflict' && code !== 'unauthenticated') {
        setNotice({ kind: 'error', code })
        setConnections(await window.api.getConnections().catch(() => connections))
      }
      return false
    }
  }

  const handleSaveConnection = async (newConn: ConnectionDraft) => {
    if (editingConnection) {
      // Update existing connection
      const updated = connections.map(c =>
        c.id === editingConnection.id ? ({ ...newConn, id: editingConnection.id } as Connection) : c
      )
      // Si no se guarda, el formulario sigue abierto para repetir el cambio
      if (!(await persist(updated))) return
      setEditingConnection(null)
      setShowModal(false)
    } else {
      const conn = {
        ...newConn,
        id: crypto.randomUUID()
      } as Connection
      const updated = [...connections, conn]
      if (!(await persist(updated))) return
      setShowModal(false)
    }
  }

  const handleEditConnection = (conn: Connection, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingConnection(conn)
    setShowModal(true)
  }

  const handleSaveFolder = async (name: string) => {
    const folder: FolderEntry = {
      id: crypto.randomUUID(),
      name,
      isFolder: true,
      parentId: null
    }
    const updated = [...connections, folder]
    if (!(await persist(updated))) return
    setShowFolderModal(false)
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const toDelete = new Set([id])
    const findChildren = (parentId: string) => {
      connections.forEach(c => {
        if (c.parentId === parentId && !toDelete.has(c.id)) {
          toDelete.add(c.id)
          if (c.isFolder) findChildren(c.id)
        }
      })
    }
    findChildren(id)
    
    const updated = connections.filter(c => !toDelete.has(c.id))
    await persist(updated)
  }

  const toggleFolder = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = new Set(expandedFolders)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedFolders(next)
  }

  const handleMoveItem = async (itemId: string, targetParentId: string | null) => {
    if (itemId === targetParentId) return
    
    if (targetParentId) {
      let currentId: string | null = targetParentId
      while (currentId) {
        if (currentId === itemId) return
        const parent = connections.find(c => c.id === currentId)
        currentId = parent?.parentId || null
      }
    }

    const updated = connections.map(c => {
      if (c.id === itemId) return { ...c, parentId: targetParentId }
      return c
    })
    await persist(updated)
  }

  const noticeText = notice && (notice.kind === 'conflict' ? t('cloud.conflict') : t('cloud.saveFailed', { reason: cloudErrorMessage(notice.code, t) }))
  const folders = connections.filter((c): c is FolderEntry => c.isFolder === true)
  const unreadableCount = connections.filter((c) => !c.isFolder && c.credentialsUnavailable).length
  const rootItems = connections.filter(c => !c.parentId)

  const renderConnection = (conn: Connection, indent = 0) => {
    const isDragOver = dragOverId === conn.id
    return (
      <li key={conn.id} 
          draggable
          onDragStart={(e) => {
            e.stopPropagation()
            setDraggedId(conn.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => {
            setDraggedId(null)
            setDragOverId(null)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (draggedId && draggedId !== conn.id) setDragOverId(conn.id)
          }}
          onDragLeave={(e) => {
            e.stopPropagation()
            if (dragOverId === conn.id) setDragOverId(null)
          }}
          onDrop={async (e) => {
            e.preventDefault()
            e.stopPropagation()
            setDragOverId(null)
            if (!draggedId || draggedId === conn.id) return
            await handleMoveItem(draggedId, conn.parentId || null)
          }}
          style={{ 
            padding: '8px 12px', 
            paddingLeft: `${12 + indent * 16}px`,
            borderRadius: 'var(--radius-sm)', 
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            transition: 'all var(--transition-fast)',
            boxShadow: isDragOver ? 'inset 0 0 0 1px var(--accent-primary)' : 'none'
          }}
          className="connection-item"
          onClick={() => onSelectConnection(conn)}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {conn.type === 'ssh'
            ? <Server size={16} color="var(--accent-primary)" />
            : <HardDrive size={16} color="var(--accent-primary)" />}
          <span style={{ fontSize: '0.9rem' }}>{conn.name}</span>
          {conn.credentialsUnavailable && (
            <span className="credentials-unavailable" title={t('store.credentialsUnavailable')} style={{ display: 'flex' }}>
              <AlertTriangle size={14} color="#eab308" />
            </span>
          )}
        </div>
        <div className="actions-group" style={{ display: 'flex', gap: '4px', opacity: 0.7 }}>
          {conn.type === 'ssh' && (
            <button className="btn-icon" title={t('terminal.open')} onClick={(e) => { e.stopPropagation(); onOpenTerminal(conn) }} style={{ padding: '4px' }}>
              <SquareTerminal size={14} />
            </button>
          )}
          <button className="btn-icon" onClick={(e) => handleEditConnection(conn, e)} style={{ padding: '4px' }}>
            <Pencil size={14} />
          </button>
          <button className="btn-icon" onClick={(e) => handleDelete(conn.id, e)} style={{ padding: '4px' }}>
            <Trash2 size={14} />
          </button>
        </div>
      </li>
    )
  }

  const renderFolder = (folder: FolderEntry, indent = 0) => {
    const isExpanded = expandedFolders.has(folder.id)
    const children = connections.filter(c => c.parentId === folder.id)
    const isDragOver = dragOverId === folder.id
    
    return (
      <React.Fragment key={folder.id}>
        <li draggable
            onDragStart={(e) => {
              e.stopPropagation()
              setDraggedId(folder.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => {
              setDraggedId(null)
              setDragOverId(null)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (draggedId && draggedId !== folder.id) setDragOverId(folder.id)
            }}
            onDragLeave={(e) => {
              e.stopPropagation()
              if (dragOverId === folder.id) setDragOverId(null)
            }}
            onDrop={async (e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragOverId(null)
              if (!draggedId || draggedId === folder.id) return
              await handleMoveItem(draggedId, folder.id)
            }}
            style={{ 
              padding: '8px 12px', 
              paddingLeft: `${12 + indent * 16}px`,
              borderRadius: 'var(--radius-sm)', 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'all var(--transition-fast)',
              boxShadow: isDragOver ? 'inset 0 0 0 1px var(--accent-primary)' : 'none'
            }}
            className="connection-item"
            onClick={(e) => toggleFolder(folder.id, e)}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isExpanded ? <ChevronDown size={14} color="var(--text-secondary)" /> : <ChevronRight size={14} color="var(--text-secondary)" />}
            <Folder size={16} color="var(--text-secondary)" />
            <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{folder.name}</span>
          </div>
          <div className="actions-group" style={{ display: 'flex', gap: '4px', opacity: 0.7 }}>
            <button className="btn-icon" onClick={(e) => handleDelete(folder.id, e)} style={{ padding: '4px' }}>
              <Trash2 size={14} />
            </button>
          </div>
        </li>
        {isExpanded && children.map(c => 
          c.isFolder ? renderFolder(c, indent + 1) : renderConnection(c, indent + 1)
        )}
      </React.Fragment>
    )
  }

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-header" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <span className="sidebar-title">{t('sidebar.title')}</span>
          <div style={{ WebkitAppRegion: 'no-drag', display: 'flex', gap: '4px' } as React.CSSProperties}>
            <button className="btn-icon" title={t('sidebar.addFolder')} onClick={() => setShowFolderModal(true)}>
              <FolderPlus size={18} />
            </button>
            <button className="btn-icon" title={t('sidebar.addConnection')} onClick={() => setShowModal(true)}>
              <Plus size={18} />
            </button>
          </div>
        </div>
        
        <div className="sidebar-content" 
             style={{ 
               padding: '12px', overflowY: 'auto', flex: 1,
               boxShadow: dragOverId === 'root' ? 'inset 0 0 0 1px var(--accent-primary)' : 'none',
               backgroundColor: dragOverId === 'root' ? 'rgba(255,255,255,0.02)' : 'transparent',
               transition: 'all 0.2s'
             }}
             onDragOver={(e) => {
               e.preventDefault()
               if (draggedId) setDragOverId('root')
             }}
             onDragLeave={() => {
               if (dragOverId === 'root') setDragOverId(null)
             }}
             onDrop={async (e) => {
               e.preventDefault()
               setDragOverId(null)
               if (!draggedId) return
               await handleMoveItem(draggedId, null)
             }}
        >
          {notice && (
            <div className={`cloud-notice ${notice.kind === 'error' ? 'error' : ''}`} role="alert">
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px', color: notice.kind === 'error' ? '#ef4444' : '#eab308' }} />
              <span>{noticeText}</span>
              <button title={t('cloud.dismiss')} onClick={() => setNotice(null)}>
                <X size={14} />
              </button>
            </div>
          )}
          {unreadableCount > 0 && (
            <div className="settings-warning store-warning" style={{ marginBottom: '12px' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px', color: '#eab308' }} />
              <span>{t('store.unreadableCredentials', { count: unreadableCount })}</span>
            </div>
          )}
          {connections.length === 0 ? (
            <div className="empty-state" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              <HardDrive size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
              <p style={{ fontSize: '0.9rem' }}>{t('sidebar.noConnections')}</p>
              <p style={{ fontSize: '0.8rem', marginTop: '6px' }}>{t('sidebar.noConnectionsHint')}</p>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, gap: '4px', display: 'flex', flexDirection: 'column' }}>
              {rootItems.map(item => 
                item.isFolder ? renderFolder(item, 0) : renderConnection(item, 0)
              )}
            </ul>
          )}
        </div>
      </aside>

      {showModal && (
        <ConnectionModal 
          folders={folders}
          notice={noticeText}
          editingConnection={editingConnection}
          onClose={() => { setShowModal(false); setEditingConnection(null) }} 
          onSave={handleSaveConnection} 
        />
      )}
      {showFolderModal && (
        <FolderModal 
          notice={noticeText}
          onClose={() => setShowFolderModal(false)} 
          onSave={handleSaveFolder} 
        />
      )}
    </>
  )
}

function ConnectionModal({ folders, notice, editingConnection, onClose, onSave }: { folders: FolderEntry[], notice: string | null, editingConnection: Connection | null, onClose: () => void, onSave: (conn: ConnectionDraft) => Promise<void> }) {
  const { t } = useTranslation()
  const editingS3 = editingConnection?.type === 's3' ? editingConnection : null
  const editingSsh = editingConnection?.type === 'ssh' ? editingConnection : null
  // Credenciales ilegibles: no se obliga a reintroducirlas; si se dejan vacías se conservan las guardadas
  const unavailable = !!editingConnection?.credentialsUnavailable
  const [type, setType] = useState<ConnectionType>(editingConnection?.type ?? 's3')
  const [name, setName] = useState(editingConnection?.name || '')
  const [parentId, setParentId] = useState<string>(editingConnection?.parentId || '')
  // S3
  const [endpoint, setEndpoint] = useState(editingS3?.endpoint || '')
  const [accessKeyId, setAccessKeyId] = useState(editingS3?.accessKeyId || '')
  const [secretAccessKey, setSecretAccessKey] = useState(editingS3?.secretAccessKey || '')
  const [bucket, setBucket] = useState(editingS3?.bucket || '')
  const [region, setRegion] = useState(editingS3?.region || 'us-east-1')
  // SSH
  const [host, setHost] = useState(editingSsh?.host || '')
  const [port, setPort] = useState(String(editingSsh?.port ?? DEFAULT_SSH_PORT))
  const [username, setUsername] = useState(editingSsh?.username || '')
  const [authMethod, setAuthMethod] = useState<SshAuthMethod>(editingSsh?.authMethod ?? 'password')
  const [password, setPassword] = useState(editingSsh?.password || '')
  const [privateKeyPath, setPrivateKeyPath] = useState(editingSsh?.privateKeyPath || '')
  const [passphrase, setPassphrase] = useState(editingSsh?.passphrase || '')
  const [initialPath, setInitialPath] = useState(editingSsh?.initialPath || '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const secrets: Record<string, string> = { accessKeyId, secretAccessKey, password, passphrase }
    const keepUnavailable = unavailable && SECRET_FIELDS[type].every((field) => !secrets[field])
    const common = { name, parentId: parentId || null, ...(keepUnavailable ? { credentialsUnavailable: true } : {}) }
    if (type === 's3') {
      onSave({ ...common, type, endpoint, accessKeyId, secretAccessKey, bucket, region })
      return
    }
    onSave({
      ...common,
      type,
      host: host.trim(),
      port: Number(port),
      username: username.trim(),
      authMethod,
      ...(authMethod === 'password' ? { password } : { privateKeyPath: privateKeyPath.trim(), passphrase }),
      ...(initialPath.trim() ? { initialPath: initialPath.trim() } : {})
    })
  }

  const handleBrowseKey = async (): Promise<void> => {
    const selected = await window.api.showOpenFileDialog()
    if (selected) setPrivateKeyPath(selected)
  }

  const field = (label: string, input: React.ReactNode): React.JSX.Element => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{label}</label>
      {input}
    </div>
  )

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
    }}>
      <div className="glass-panel animate-fade-in" style={{ padding: '24px', width: '420px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 600 }}>{editingConnection ? t('sidebar.editConnection') : t('sidebar.newConnection')}</h3>
          <button className="btn-icon" onClick={onClose}><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {notice && <SaveNoticeBanner text={notice} />}
          {unavailable && (
            <div className="settings-warning">
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px', color: '#eab308' }} />
              <span>{t('store.reenterCredentials')}</span>
            </div>
          )}
          {field(t('sidebar.connectionType'), (
            <div style={{ display: 'flex', gap: '8px' }}>
              {(['s3', 'ssh'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={!!editingConnection && option !== type}
                  onClick={() => setType(option)}
                  style={{
                    ...btnStyle, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    background: type === option ? 'var(--accent-primary)' : 'transparent',
                    color: type === option ? 'white' : 'var(--text-secondary)',
                    border: '1px solid var(--border-light)',
                    opacity: !!editingConnection && option !== type ? 0.4 : 1,
                    cursor: editingConnection ? 'default' : 'pointer'
                  }}
                >
                  {option === 's3' ? <HardDrive size={14} /> : <Server size={14} />}
                  {option === 's3' ? t('sidebar.typeS3') : t('sidebar.typeSsh')}
                </button>
              ))}
            </div>
          ))}
          {field(t('sidebar.connectionName'), (
            <input required type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('sidebar.connectionNamePlaceholder')} style={inputStyle} />
          ))}
          {field(t('sidebar.folder'), (
            <select value={parentId} onChange={e => setParentId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="" style={{ background: '#222', color: 'white' }}>{t('sidebar.folderNone')}</option>
              {folders.map(f => <option key={f.id} value={f.id} style={{ background: '#222', color: 'white' }}>{f.name}</option>)}
            </select>
          ))}

          {type === 's3' ? (
            <>
              {field(t('sidebar.endpointUrl'), <input required type="url" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://..." style={inputStyle} />)}
              {field(t('sidebar.region'), <input type="text" value={region} onChange={e => setRegion(e.target.value)} placeholder="us-east-1" style={inputStyle} />)}
              {field(t('sidebar.accessKeyId'), <input required={!unavailable} type="text" value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} style={inputStyle} />)}
              {field(t('sidebar.secretAccessKey'), <input required={!unavailable} type="password" value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)} style={inputStyle} />)}
              {field(t('sidebar.defaultBucket'), <input type="text" value={bucket} onChange={e => setBucket(e.target.value)} style={inputStyle} />)}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  {field(t('sidebar.host'), <input required type="text" value={host} onChange={e => setHost(e.target.value)} placeholder="server.example.com" style={inputStyle} />)}
                </div>
                <div style={{ width: '90px' }}>
                  {field(t('sidebar.port'), <input required type="number" min={1} max={65535} value={port} onChange={e => setPort(e.target.value)} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />)}
                </div>
              </div>
              {field(t('sidebar.username'), <input required type="text" value={username} onChange={e => setUsername(e.target.value)} style={inputStyle} />)}
              {field(t('sidebar.authMethod'), (
                <select value={authMethod} onChange={e => setAuthMethod(e.target.value as SshAuthMethod)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="password" style={{ background: '#222', color: 'white' }}>{t('sidebar.authPassword')}</option>
                  <option value="privateKey" style={{ background: '#222', color: 'white' }}>{t('sidebar.authPrivateKey')}</option>
                </select>
              ))}
              {authMethod === 'password' ? (
                field(t('sidebar.password'), <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />)
              ) : (
                <>
                  {field(t('sidebar.privateKeyPath'), (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input required type="text" value={privateKeyPath} onChange={e => setPrivateKeyPath(e.target.value)} placeholder="~/.ssh/id_ed25519" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
                      <button type="button" onClick={handleBrowseKey} style={{ ...btnStyle, background: 'transparent', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>{t('sidebar.browse')}</button>
                    </div>
                  ))}
                  {field(t('sidebar.passphrase'), <input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} style={inputStyle} />)}
                </>
              )}
              {field(t('sidebar.initialPath'), <input type="text" value={initialPath} onChange={e => setInitialPath(e.target.value)} placeholder={t('sidebar.initialPathPlaceholder')} style={inputStyle} />)}
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
            <button type="button" onClick={onClose} style={{ ...btnStyle, background: 'transparent', border: '1px solid var(--border-light)' }}>{t('sidebar.cancel')}</button>
            <button type="submit" style={{ ...btnStyle, background: 'var(--accent-primary)', color: 'white' }}>{editingConnection ? t('sidebar.update') : t('sidebar.saveConnection')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function FolderModal({ notice, onClose, onSave }: { notice: string | null, onClose: () => void, onSave: (name: string) => Promise<void> }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim()) onSave(name.trim())
  }
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
    }}>
      <div className="glass-panel animate-fade-in" style={{ padding: '24px', width: '300px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 600 }}>{t('sidebar.newFolder')}</h3>
          <button className="btn-icon" onClick={onClose}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {notice && <SaveNoticeBanner text={notice} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('sidebar.folderName')}</label>
            <input required autoFocus type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('sidebar.folderNamePlaceholder')} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
            <button type="button" onClick={onClose} style={{ ...btnStyle, background: 'transparent', border: '1px solid var(--border-light)' }}>{t('sidebar.cancel')}</button>
            <button type="submit" style={{ ...btnStyle, background: 'var(--accent-primary)', color: 'white' }}>{t('sidebar.save')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// El aviso del último guardado también dentro del formulario abierto: el fondo lo tapa
function SaveNoticeBanner({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="cloud-notice" role="alert" style={{ marginBottom: 0 }}>
      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px', color: '#eab308' }} />
      <span>{text}</span>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-light)',
  padding: '8px 12px', borderRadius: '4px', color: 'white', outline: 'none'
}
const btnStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 500,
  transition: 'all var(--transition-fast)'
}
