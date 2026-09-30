import { useParams, Link } from 'react-router-dom'
import { useState } from 'react'
import { getSet } from '../store.js'

export default function SetPage() {
  const { id } = useParams()
  const [set] = useState(() => getSet(id))

  if (!set) {
    return (
      <div className="page">
        <div className="empty">
          <p>Набор не найден.</p>
          <Link className="btn btn-primary" to="/">К моим наборам</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="set-head">
        <Link to="/" className="back-link">← Мои наборы</Link>
        <h1>{set.topic || 'Без названия'}</h1>
        <span className="set-count big">{set.cards.length} карточек</span>
      </div>

      {set.lesson_meta && (set.lesson_meta.song || (set.lesson_meta.grammar && set.lesson_meta.grammar.length > 0)) && (
        <div className="lesson-meta">
          {set.lesson_meta.song && (
            <p><strong>Песня:</strong> {set.lesson_meta.song}</p>
          )}
          {set.lesson_meta.grammar && set.lesson_meta.grammar.length > 0 && (
            <div className="grammar">
              <strong>Грамматика:</strong>
              <ul>
                {set.lesson_meta.grammar.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="cards">
        {set.cards.map((card, i) => (
          <div className="card-row" key={i}>
            <div className="card-top">
              <span className="card-word">{card.word}</span>
              <span className="card-translation">{card.translation}</span>
            </div>
            {card.family && <div className="card-family"><strong>Родственные формы:</strong> {card.family}</div>}
            {card.examples && card.examples.length > 0 && (
              <ul className="card-examples">
                {card.examples.map((ex, j) => (
                  <li key={j}>
                    <span className="ex-en">{ex.en}</span>
                    <span className="ex-ru">{ex.ru}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
