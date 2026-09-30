import { useParams, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getSet, recordCardView } from '../store.js'

export default function SetPage() {
  const { id } = useParams()
  const [set] = useState(() => getSet(id))
  const [mode, setMode] = useState('cards')
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const count = set ? set.cards.length : 0
  const current = set ? set.cards[index] || null : null

  // View counter: increments for the currently displayed card (keyed on index).
  useEffect(() => {
    if (!current) return
    recordCardView(id, index)
  }, [id, index, current])

  const goPrev = () => {
    setIndex((i) => Math.max(i - 1, 0))
    setFlipped(false)
  }
  const goNext = () => {
    setIndex((i) => Math.min(i + 1, count - 1))
    setFlipped(false)
  }

  // Hotkeys: ArrowLeft/ArrowRight = prev/next, Space = flip.
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setIndex((i) => Math.min(i + 1, count - 1))
        setFlipped(false)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setIndex((i) => Math.max(i - 1, 0))
        setFlipped(false)
      } else if (e.key === ' ') {
        e.preventDefault()
        setFlipped((f) => !f)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [count])

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

      <div className="mode-switcher" role="tablist" aria-label="Режим просмотра">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'cards'}
          className={'mode-btn' + (mode === 'cards' ? ' active' : '')}
          onClick={() => setMode('cards')}
        >
          Карточки
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'test'}
          className={'mode-btn' + (mode === 'test' ? ' active' : '')}
          title="Режим теста появится в K3"
        >
          Тест
          <span className="mode-k3">K3</span>
        </button>
      </div>

      {mode === 'test' ? (
        <div className="test-placeholder">
          <p>🧪 Режим теста будет реализован в K3.</p>
        </div>
      ) : count === 0 ? (
        <div className="test-placeholder">
          <p>В этом наборе нет карточек.</p>
        </div>
      ) : (
        <div className="deck">
          <div
            className="flashcard-scene"
            role="button"
            tabIndex={0}
            onClick={() => setFlipped((f) => !f)}
            onKeyDown={(e) => { if (e.key === 'Enter') setFlipped((f) => !f) }}
          >
            <div className={'flashcard' + (flipped ? ' flipped' : '')}>
              <div className="flashcard-face front">
                <span className="face-label">EN · Слово</span>
                <h2 className="face-word">{current.word}</h2>
                <span className="face-hint">Нажмите, чтобы перевернуть</span>
              </div>
              <div className="flashcard-face back">
                <span className="face-label">RU · Перевод</span>
                <h3 className="back-translation">{current.translation}</h3>
                {current.examples && current.examples[0] && (
                  <div className="back-example">
                    <p className="ex-en">{current.examples[0].en}</p>
                    <p className="ex-ru">{current.examples[0].ru}</p>
                  </div>
                )}
                {current.family && (
                  <p className="back-family"><strong>Родственные формы:</strong> {current.family}</p>
                )}
              </div>
            </div>
          </div>

          <div className="deck-controls">
            <button className="btn btn-outline" onClick={goPrev} disabled={index === 0}>← Назад</button>
            <span className="deck-progress">Карточка {index + 1} из {count}</span>
            <button className="btn btn-outline" onClick={goNext} disabled={index === count - 1}>Вперёд →</button>
          </div>
        </div>
      )}
    </div>
  )
}
