import { Link } from 'react-router-dom'
import { useState } from 'react'
import { loadSets, removeSet } from '../store.js'

export default function MySets() {
  const [sets, setSets] = useState(loadSets)

  const handleDelete = (id) => {
    removeSet(id)
    setSets(loadSets())
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Мои наборы</h1>
        <Link className="btn btn-primary" to="/sets/new">+ Импорт JSON</Link>
      </div>

      {sets.length === 0 ? (
        <div className="empty">
          <p>У вас пока нет наборов.</p>
          <Link className="btn btn-primary" to="/sets/new">Импортировать первый набор</Link>
        </div>
      ) : (
        <div className="set-grid">
          {sets.map((set) => (
            <div className="set-card" key={set.id}>
              <Link to={`/set/${set.id}`} className="set-card-main">
                <h3 className="set-title">{set.topic || 'Без названия'}</h3>
                <span className="set-count">{set.cards.length} карточек</span>
              </Link>
              <button className="btn-icon" title="Удалить" onClick={() => handleDelete(set.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
