import { useParams, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getSet, recordCardView } from '../store.js'

// ---------- Test mode helpers ----------

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// The answer shown for a card depends on the quiz direction.
function answerOf(card, direction) {
  return direction === 'en-ru' ? card.translation : card.word
}

// Build the 4 choice values for one question: the correct answer + 3 distinct
// wrong answers drawn from other cards in the same set. If the set has fewer
// than 4 distinct possible answers, reduce gracefully to what's available.
function makeChoices(cards, cardIndex, direction) {
  const card = cards[cardIndex]
  const correct = answerOf(card, direction)
  const seen = new Set([correct])
  const wrongs = []
  cards.forEach((c, i) => {
    if (i === cardIndex) return
    const v = answerOf(c, direction)
    if (!seen.has(v)) {
      seen.add(v)
      wrongs.push(v)
    }
  })
  const pool = [correct, ...wrongs]
  if (wrongs.length < 3) return shuffle(pool) // fewer distinct answers available
  return shuffle([correct, ...shuffle(wrongs).slice(0, 3)])
}

// Fresh quiz state for a full run in the given direction.
function initQuiz(cards, direction) {
  const order = shuffle(cards.map((_, i) => i)) // shuffle question cards at start
  return {
    direction,
    order,
    pos: 0,
    score: 0,
    picked: null,
    done: cards.length === 0,
    choices: cards.length ? makeChoices(cards, order[0], direction) : [],
  }
}

// Full quiz component rendered inside SetPage when mode === 'test'.
function Quiz({ set, id }) {
  const cards = set.cards
  const [q, setQ] = useState(() => initQuiz(cards, 'en-ru'))
  const { direction, order, pos, score, picked, done, choices } = q
  const n = cards.length
  const card = done ? null : cards[order[pos]]
  const correct = card ? answerOf(card, direction) : ''
  const answered = picked !== null
  const progress = n ? Math.min((pos + (answered ? 1 : 0)) / n, 1) : 0

  // Record a view for the currently displayed card (original index, not the
  // shuffled position) whenever its question is shown in test mode.
  useEffect(() => {
    if (done || n === 0) return
    recordCardView(id, order[pos])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, done, pos, order])

  const switchDirection = (dir) => {
    setQ((s) => (s.direction === dir ? s : initQuiz(cards, dir)))
  }

  const choose = (val) => {
    setQ((s) => {
      if (s.picked !== null) return s
      const c = cards[s.order[s.pos]]
      return { ...s, picked: val, score: s.score + (val === answerOf(c, s.direction) ? 1 : 0) }
    })
  }

  const next = () => {
    setQ((s) => {
      if (s.pos >= n - 1) return { ...s, done: true }
      const nextPos = s.pos + 1
      return { ...s, pos: nextPos, picked: null, choices: makeChoices(cards, s.order[nextPos], s.direction) }
    })
  }

  const restart = () => setQ((s) => initQuiz(cards, s.direction))

  if (done) {
    const pct = n ? Math.round((score / n) * 100) : 0
    return (
      <div className="quiz quiz-result">
        <h2>Тест завершён</h2>
        <p className="quiz-result-score">{score} из {n} правильных</p>
        <p className="quiz-result-pct">{pct}%</p>
        <button type="button" className="btn btn-primary" onClick={restart}>
          Начать заново
        </button>
      </div>
    )
  }

  const prompt = direction === 'en-ru' ? card.word : card.translation
  const wrongPick = answered && picked !== correct

  return (
    <div className="quiz">
      <div className="quiz-direction" role="tablist" aria-label="Направление теста">
        <button
          type="button"
          role="tab"
          aria-selected={direction === 'en-ru'}
          className={'quiz-dir-btn' + (direction === 'en-ru' ? ' active' : '')}
          onClick={() => switchDirection('en-ru')}
        >
          en-ru
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={direction === 'ru-en'}
          className={'quiz-dir-btn' + (direction === 'ru-en' ? ' active' : '')}
          onClick={() => switchDirection('ru-en')}
        >
          ru-en
        </button>
      </div>

      <div className="quiz-meta">
        <span className="quiz-score">{score} / {pos + (answered ? 1 : 0)} правильных</span>
        <span className="quiz-count">Вопрос {pos + 1} из {n}</span>
      </div>
      <div className="quiz-progress">
        <div className="quiz-progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      <div className="quiz-card">
        <span className="face-label">{direction === 'en-ru' ? 'EN · Слово' : 'RU · Перевод'}</span>
        <h2 className="quiz-word">{prompt}</h2>
      </div>

      <div className="quiz-choices">
        {choices.map((val, i) => {
          let cls = 'quiz-choice'
          if (answered && val === correct) cls += ' correct'
          if (answered && val === picked && val !== correct) cls += ' wrong'
          return (
            <button key={i} type="button" className={cls} disabled={answered} onClick={() => choose(val)}>
              {val}
            </button>
          )
        })}
      </div>

      {wrongPick && (
        <div className="quiz-hint">
          <strong>Подсказка:</strong>
          {card.examples && card.examples[0] ? (
            <>
              <p className="ex-en">{card.examples[0].en}</p>
              <p className="ex-ru">{card.examples[0].ru}</p>
            </>
          ) : (
            <p className="ex-ru">Правильный ответ: {correct}</p>
          )}
          {card.family && <p className="back-family"><strong>Родственные формы:</strong> {card.family}</p>}
        </div>
      )}

      {answered && (
        <button type="button" className="btn btn-primary quiz-next" onClick={next}>
          Далее
        </button>
      )}
    </div>
  )
}

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
          title="Режим теста"
          onClick={() => setMode('test')}
        >
          Тест
          <span className="mode-k3">K3</span>
        </button>
      </div>

      {mode === 'test' ? (
        count === 0 ? (
          <div className="test-placeholder">
            <p>В этом наборе нет карточек.</p>
          </div>
        ) : (
          <Quiz set={set} id={id} />
        )
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
