import { Link } from 'react-router-dom'
import { useState } from 'react'
import { loadSets, removeSet, getDayStreak, getStatuses, downloadProgressReport } from '../store.js'

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

export default function MySets() {
  const [sets, setSets] = useState(loadSets)

  const handleDelete = (id) => {
    removeSet(id)
    setSets(loadSets())
  }

  const streak = getDayStreak()

  return (
    <div className="page">
      <div className="page-head">
        <h1>Мои наборы</h1>
        <div className="page-head-actions">
          {streak > 0 && (
            <span className="k9-streak" title="Подряд дней занятий">
              🔥 {streak} {streakWord(streak)}
            </span>
          )}
          <button type="button" className="btn btn-outline" onClick={downloadProgressReport}>
            Скачать отчёт
          </button>
          <Link className="btn btn-primary" to="/sets/new">+ Импорт JSON</Link>
        </div>
      </div>

      {sets.length === 0 ? (
        <div className="empty">
          <p>У вас пока нет наборов.</p>
          <Link className="btn btn-primary" to="/sets/new">Импортировать первый набор</Link>
        </div>
      ) : (
        <div className="set-grid">
          {sets.map((set) => {
            const pct = masteryOf(set)
            return (
              <div className="set-card" key={set.id}>
                <Link to={`/set/${set.id}`} className="set-card-main">
                  <h3 className="set-title">{set.topic || 'Без названия'}</h3>
                  <span className="set-count">{set.cards.length} карточек</span>
                  <span className="set-memory">Память: {pct}%</span>
                </Link>
                <button className="btn-icon" title="Удалить" onClick={() => handleDelete(set.id)}>✕</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
