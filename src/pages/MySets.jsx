import { Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  loadSets, removeSet, getDayStreak, getStatuses, downloadProgressReport,
  loadFolders, saveFolders, addFolder, removeFolder, renameFolder,
  folderAssignSet, folderUnassignSet,
  loadClasses, saveClasses, addClass, removeClass, renameClass,
  classSetMember, classSetUnmember, buildLeaderboard,
  syncSetsFromServer, deleteSetShared,
  bookmarkSetShared, unbookmarkSetShared, loadMySetIds,
} from '../store.js'
import { useAuth } from '../auth.jsx'
import LoginModal from '../components/LoginModal.jsx'

// Share of a set's cards currently mastered, as a percentage (rounded).
function masteryOf(set) {
  const statuses = getStatuses(set.id)
  let mastered = 0
  for (let i = 0; i < set.cards.length; i++) {
    if ((statuses[String(i)] || 'not_studied') === 'mastered') mastered += 1
  }
  return set.cards.length ? Math.round((mastered / set.cards.length) * 100) : 0
}

function streakWord(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'день'
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'дня'
  return 'дней'
}

// Format a Match record's elapsed time (same logic as the game's fmtMs).
function fmtMs(ms) {
  const totalSec = ms / 1000
  if (totalSec < 60) return totalSec.toFixed(1) + ' с'
  const m = Math.floor(totalSec / 60)
  const s = (totalSec % 60).toFixed(1)
  return m + ':' + String(s).padStart(4, '0')
}

export default function MySets() {
  const { username, isLoggedIn } = useAuth()
  const [sets, setSets] = useState(loadSets)
  const [folders, setFolders] = useState(loadFolders)
  const [classes, setClasses] = useState(loadClasses)
  const [leaderboard, setLeaderboard] = useState(buildLeaderboard)
  // K18: home page tabs ('mine' = user's own+bookmarked sets, 'all' = everything).
  const [tab, setTab] = useState('all')
  const [mySetIds, setMySetIds] = useState([])
  // K19: quick login for guests (same modal as header).
  const [loginOpen, setLoginOpen] = useState(false)

  // Folder UI state.
  const [newFolder, setNewFolder] = useState('')
  const [filterFolder, setFilterFolder] = useState('all') // 'all' | folderId
  const [editingFolder, setEditingFolder] = useState(null) // folderId
  const [renameText, setRenameText] = useState('')
  const [assignFor, setAssignFor] = useState('') // folderId whose select is open

  // Class UI state.
  const [newClass, setNewClass] = useState('')
  const [editingClass, setEditingClass] = useState(null)
  const [classRename, setClassRename] = useState('')

  // PRIO: on load, pull the shared set list from the server. On success the
  // server becomes the source of truth and the local cache/UI is replaced with
  // the server's sets; on failure (server unreachable) the existing localStorage
  // sets are used unchanged.
  useEffect(() => {
    let cancelled = false
    syncSetsFromServer().then(() => {
      if (!cancelled) refresh()
    })
    return () => { cancelled = true }
  }, [])

  // K18: load the ids the current user owns+bookmarked whenever login changes.
  useEffect(() => {
    if (!isLoggedIn) {
      setMySetIds([])
      return
    }
    let cancelled = false
    loadMySetIds().then((ids) => { if (!cancelled) setMySetIds(ids) })
    return () => { cancelled = true }
  }, [isLoggedIn])

  const refresh = () => {
    setSets(loadSets())
    if (isLoggedIn) loadMySetIds().then(setMySetIds)
    setFolders(loadFolders())
    setClasses(loadClasses())
    setLeaderboard(buildLeaderboard())
  }

  const handleDelete = (id) => {
    // PRIO: delete on the server (shared), falling back to localStorage-only
    // removal when the server is unreachable.
    deleteSetShared(id).then(refresh)
  }

  const handleCreateFolder = () => {
    if (!newFolder.trim()) return
    addFolder(newFolder.trim())
    setNewFolder('')
    refresh()
  }

  const handleRemoveFolder = (id) => {
    removeFolder(id)
    if (filterFolder === id) setFilterFolder('all')
    refresh()
  }

  const handleRenameFolder = (id) => {
    if (renameText.trim()) renameFolder(id, renameText.trim())
    setEditingFolder(null)
    setRenameText('')
    refresh()
  }

  const handleAssign = (folderId, setId) => {
    folderAssignSet(folderId, setId)
    setAssignFor('')
    refresh()
  }

  const handleCreateClass = () => {
    if (!newClass.trim()) return
    addClass(newClass.trim())
    setNewClass('')
    refresh()
  }

  const handleRenameClass = (id) => {
    if (classRename.trim()) renameClass(id, classRename.trim())
    setEditingClass(null)
    setClassRename('')
    refresh()
  }

  const handleClassToggle = (classId, setId, isMember) => {
    if (isMember) classSetUnmember(classId, setId)
    else classSetMember(classId, setId)
    refresh()
  }

  const streak = getDayStreak()

  // Sets visible under the current folder filter.
  const folderFiltered = filterFolder === 'all'
    ? sets
    : sets.filter((s) => {
        const folder = folders.find((f) => f.id === filterFolder)
        return folder ? folder.setIds.includes(s.id) : false
      })
  // K18: the set ids the current user owns + bookmarked (from the server).
  const myIds = new Set(mySetIds)

  // K18: tab selection ('mine' = user's own+bookmarked sets, 'all' = everything).
  const displaySets = tab === 'mine'
    ? folderFiltered.filter((s) => myIds.has(s.id))
    : folderFiltered

  const handleBookmark = (id) => bookmarkSetShared(id).then(refresh)
  const handleUnbookmark = (id) => unbookmarkSetShared(id).then(refresh)

  const setCard = (set) => {
    const pct = masteryOf(set)
    const isMine = myIds.has(set.id)
    const author = set.author ? set.author : '—'
    return (
      <div className="set-card" key={set.id}>
        <div className="set-card-actions-top">
          <Link to={`/set/${set.id}`} className="set-card-main">
            <h3 className="set-title">{set.topic || 'Без названия'}</h3>
            <span className="set-count">{set.cards.length} карточек</span>
            <span className="set-memory">Память: {pct}%</span>
            <span className="set-author">Автор: {author}</span>
          </Link>
          <button className="btn-icon" title="Удалить" onClick={() => handleDelete(set.id)}>✕</button>
        </div>
        <div className="set-card-actions">
          {isLoggedIn && (isMine ? (
            <button type="button" className="btn btn-outline" onClick={() => handleUnbookmark(set.id)}>
              Убрать
            </button>
          ) : (
            <button type="button" className="btn btn-outline" onClick={() => handleBookmark(set.id)}>
              Добавить к себе
            </button>
          ))}
          <Link className="btn btn-primary" to={`/set/${set.id}`}>Посмотреть</Link>
        </div>
      </div>
    )
  }

  // Build a select of sets available to add to a given folder.
  const folderUnassigned = (folder) => sets.filter((s) => !folder.setIds.includes(s.id))

  return (
    <div className="page">
      <div className="page-head">
        <h1>Мои наборы</h1>
        <div className="page-head-actions">
          {isLoggedIn ? (
            <>
              {streak > 0 && (
                <span className="k9-streak" title="Подряд дней занятий">
                  🔥 {streak} {streakWord(streak)}
                </span>
              )}
              <button type="button" className="btn btn-outline" onClick={downloadProgressReport}>
                Скачать отчёт
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              data-testid="home-login-btn"
              onClick={() => setLoginOpen(true)}
            >
              Войти, чтобы тренироваться
            </button>
          )}
          <Link className="btn btn-primary" to="/sets/new">+ Импорт JSON</Link>
        </div>
      </div>

      {/* ---------- K11 Leaderboards ---------- */}
      <section className="k11-panel" data-testid="k11-leaderboard">
        <h2 className="k11-panel-title">🏆 Лидерборды</h2>
        <div className="k11-lb-cols">
          <div className="k11-lb">
            <h3>Лучшее время Match</h3>
            {leaderboard.match.length === 0 ? (
              <p className="k11-lb-empty">Нет записей. Сыграйте в Match!</p>
            ) : (
              <table className="k11-lb-table">
                <thead><tr><th>#</th><th>Набор</th><th>Время</th></tr></thead>
                <tbody>
                  {leaderboard.match.map((r, i) => (
                    <tr key={r.setId + i}>
                      <td>{i + 1}</td>
                      <td><Link to={`/set/${r.setId}`}>{r.topic}</Link></td>
                      <td className="k11-lb-val">{fmtMs(r.ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="k11-lb">
            <h3>Лучшие очки Blast</h3>
            {leaderboard.blast.length === 0 ? (
              <p className="k11-lb-empty">Нет записей. Сыграйте в Blast!</p>
            ) : (
              <table className="k11-lb-table">
                <thead><tr><th>#</th><th>Набор</th><th>Очки</th></tr></thead>
                <tbody>
                  {leaderboard.blast.map((r, i) => (
                    <tr key={r.setId + i}>
                      <td>{i + 1}</td>
                      <td><Link to={`/set/${r.setId}`}>{r.topic}</Link></td>
                      <td className="k11-lb-val">{r.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      {/* ---------- K11 Folders ---------- */}
      <section className="k11-panel" data-testid="k11-folders">
        <h2 className="k11-panel-title">📁 Папки</h2>

        <div className="k11-create-row">
          <input
            className="write-input k11-input"
            placeholder="Название новой папки…"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            data-testid="folder-name-input"
          />
          <button type="button" className="btn btn-primary" onClick={handleCreateFolder} data-testid="folder-create">
            Создать папку
          </button>
        </div>

        {folders.length > 0 && (
          <>
            <div className="k11-filter-row">
              <span className="k11-filter-label">Фильтр по папке:</span>
              <select
                className="play-interval"
                value={filterFolder}
                onChange={(e) => setFilterFolder(e.target.value)}
                data-testid="folder-filter"
              >
                <option value="all">Все наборы</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            <div className="k11-folder-list">
              {folders.map((f) => (
                <div className="k11-folder" key={f.id} data-testid="folder-item">
                  <div className="k11-folder-head">
                    {editingFolder === f.id ? (
                      <span className="k11-edit-row">
                        <input
                          className="write-input k11-input"
                          value={renameText}
                          onChange={(e) => setRenameText(e.target.value)}
                          data-testid="folder-rename-input"
                        />
                        <button className="btn btn-outline" onClick={() => handleRenameFolder(f.id)}>Сохранить</button>
                      </span>
                    ) : (
                      <span className="k11-folder-name">
                        <strong>{f.name}</strong>
                        <span className="k11-count">{f.setIds.length} наборов</span>
                      </span>
                    )}
                    <span className="k11-folder-actions">
                      <button
                        className="btn-icon" title="Переименовать"
                        onClick={() => { setEditingFolder(f.id); setRenameText(f.name) }}
                      >✎</button>
                      <button className="btn-icon" title="Удалить папку" onClick={() => handleRemoveFolder(f.id)}>✕</button>
                    </span>
                  </div>

                  <div className="k11-folder-sets">
                    {f.setIds.map((sid) => {
                      const s = sets.find((x) => x.id === sid)
                      if (!s) return null
                      return (
                        <span className="k11-chip" key={sid}>
                          <Link to={`/set/${sid}`}>{s.topic || 'Без названия'}</Link>
                          <button
                            className="k11-chip-x" title="Убрать из папки"
                            onClick={() => { folderUnassignSet(f.id, sid); refresh() }}
                          >✕</button>
                        </span>
                      )
                    })}
                  </div>

                  <div className="k11-folder-assign">
                    {assignFor === f.id ? (
                      <select
                        className="play-interval"
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) handleAssign(f.id, e.target.value) }}
                        data-testid="folder-assign-select"
                      >
                        <option value="" disabled>Выберите набор…</option>
                        {folderUnassigned(f).map((s) => (
                          <option key={s.id} value={s.id}>{s.topic || 'Без названия'}</option>
                        ))}
                      </select>
                    ) : (
                      <button type="button" className="btn btn-outline" onClick={() => setAssignFor(f.id)} data-testid="folder-assign-open">
                        + Добавить набор
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ---------- K11 Classes (local) ---------- */}
      <section className="k11-panel" data-testid="k11-classes">
        <h2 className="k11-panel-title">🏫 Классы</h2>

        <div className="k11-create-row">
          <input
            className="write-input k11-input"
            placeholder="Название нового класса…"
            value={newClass}
            onChange={(e) => setNewClass(e.target.value)}
            data-testid="class-name-input"
          />
          <button type="button" className="btn btn-primary" onClick={handleCreateClass} data-testid="class-create">
            Создать класс
          </button>
        </div>

        {classes.length > 0 && (
          <div className="k11-class-list">
            {classes.map((c) => (
              <div className="k11-class" key={c.id} data-testid="class-item">
                <div className="k11-folder-head">
                  {editingClass === c.id ? (
                    <span className="k11-edit-row">
                      <input
                        className="write-input k11-input"
                        value={classRename}
                        onChange={(e) => setClassRename(e.target.value)}
                        data-testid="class-rename-input"
                      />
                      <button className="btn btn-outline" onClick={() => handleRenameClass(c.id)}>Сохранить</button>
                    </span>
                  ) : (
                    <span className="k11-folder-name">
                      <strong>{c.name}</strong>
                      <span className="k11-count">{c.setIds.length} наборов</span>
                    </span>
                  )}
                  <span className="k11-folder-actions">
                    <button className="btn-icon" title="Переименовать" onClick={() => { setEditingClass(c.id); setClassRename(c.name) }}>✎</button>
                    <button className="btn-icon" title="Удалить класс" onClick={() => { removeClass(c.id); refresh() }}>✕</button>
                  </span>
                </div>

                <div className="k11-class-pick">
                  <span className="k11-filter-label">Наборы класса:</span>
                  <div className="k11-class-checkboxes">
                    {sets.map((s) => {
                      const isMember = c.setIds.includes(s.id)
                      return (
                        <label className="k11-class-check" key={s.id}>
                          <input
                            type="checkbox"
                            checked={isMember}
                            onChange={() => handleClassToggle(c.id, s.id, isMember)}
                          />
                          <span>{s.topic || 'Без названия'}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- K18 tabs: "Мои наборы" vs "Общие наборы" ---------- */}
      <div className="k18-tabs" role="tablist">
        <button
          type="button"
          className={'k18-tab' + (tab === 'all' ? ' active' : '')}
          role="tab"
          aria-selected={tab === 'all'}
          onClick={() => setTab('all')}
        >
          Общие наборы
        </button>
        <button
          type="button"
          className={'k18-tab' + (tab === 'mine' ? ' active' : '')}
          role="tab"
          aria-selected={tab === 'mine'}
          onClick={() => setTab('mine')}
        >
          Мои наборы
        </button>
      </div>

      {filterFolder !== 'all' && (
        <p className="k11-filter-hint">
          Показаны наборы из папки «{folders.find((f) => f.id === filterFolder)?.name || ''}».
        </p>
      )}

      {tab === 'mine' && !isLoggedIn ? (
        <div className="empty">
          <p>Войдите, чтобы увидеть свои наборы.</p>
        </div>
      ) : displaySets.length === 0 ? (
        <div className="empty">
          <p>
            {tab === 'mine'
              ? 'У вас пока нет своих наборов. Нажмите «Добавить к себе» на общем наборе.'
              : 'Нет наборов' + (filterFolder !== 'all' ? ' в этой папке' : '') + '.'}
          </p>
          {filterFolder === 'all' && tab === 'all' && (
            <Link className="btn btn-primary" to="/sets/new">Импортировать первый набор</Link>
          )}
        </div>
      ) : (
        <div className="set-grid" data-testid="set-grid">
          {displaySets.map(setCard)}
        </div>
      )}

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}
