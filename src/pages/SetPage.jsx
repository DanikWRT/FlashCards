import { useParams, Link } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getSet, getStats, getStatus, getStatuses, setCardStatus, recordCardView } from '../store.js'

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

// K6 study (Learn/Write) shared helpers ------------------------------------------

// Adaptive work order for a set: not-yet-mastered cards first, then mastered;
// among non-mastered, learning-status cards (had an error) ahead of not_studied,
// then fewest view-count first; stable tiebreak by card index.
const STATUS_RANK = { learning: 0, not_studied: 1, mastered: 2 }

function adaptiveOrder(id, cards) {
  const stats = getStats(id)
  const statuses = getStatuses(id)
  const idxs = cards.map((_, i) => i)
  return [...idxs].sort((a, b) => {
    const ra = STATUS_RANK[statuses[String(a)] || 'not_studied']
    const rb = STATUS_RANK[statuses[String(b)] || 'not_studied']
    if (ra !== rb) return ra - rb
    const va = stats[String(a)] || 0
    const vb = stats[String(b)] || 0
    if (va !== vb) return va - vb
    return a - b
  })
}

// Initial work queue excludes cards already mastered in a previous session.
function initialQueue(id, cards) {
  return adaptiveOrder(id, cards).filter((i) => getStatus(id, i) !== 'mastered')
}

function countMastered(id, cards) {
  return cards.reduce((acc, _, i) => acc + (getStatus(id, i) === 'mastered' ? 1 : 0), 0)
}

// Shared state machine for Learn (multiple choice) and Write (typed input).
// Tracks a per-session consecutive-correct streak per card: 2 in a row -> mastered,
// any error -> learning. Queue is advanced on `advance()`; mastered cards leave the
// queue, un-mastered ones go back to the end so difficult cards get repeated.
function useStudySession(set, id) {
  const cards = set.cards
  const n = cards.length
  const [direction, setDirection] = useState('en-ru')
  const [queue, setQueue] = useState(() => initialQueue(id, cards))
  const [streaks, setStreaks] = useState({})
  const [masteredCount, setMasteredCount] = useState(() => countMastered(id, cards))
  const [running, setRunning] = useState(queue.length > 0)

  const idx = running && queue.length ? queue[0] : -1
  const card = idx >= 0 ? cards[idx] : null

  // Apply a correct/wrong result to the current card's status + streak. Returns true if mastered.
  const applyResult = (correct) => {
    const i = queue[0]
    const s = { ...streaks }
    if (correct) {
      const ns = (s[i] || 0) + 1
      s[i] = ns
      if (ns >= 2) {
        setCardStatus(id, i, 'mastered')
        setMasteredCount((c) => c + 1)
      } else {
        setCardStatus(id, i, 'learning')
      }
    } else {
      s[i] = 0
      setCardStatus(id, i, 'learning')
    }
    setStreaks(s)
  }

  // Advance to the next card; mastered ones leave the queue, others cycle to the end.
  const advance = () => {
    const i = queue[0]
    const cleaned = queue.filter((x) => x !== i)
    const mastered = (streaks[i] || 0) >= 2
    const nextQueue = mastered ? cleaned : [...cleaned, i]
    if (nextQueue.length === 0) {
      setQueue([])
      setRunning(false)
    } else {
      setQueue(nextQueue)
    }
  }

  const restart = () => {
    setStreaks({})
    setQueue(initialQueue(id, cards))
    setRunning(initialQueue(id, cards).length > 0)
    setMasteredCount(countMastered(id, cards))
  }

  return {
    direction, setDirection, idx, card, masteredCount, n, running, applyResult, advance, restart,
  }
}

// Shared direction switcher used by Learn and Write (like Quiz's).
function StudyDirection({ direction, setDirection }) {
  return (
    <div className="quiz-direction" role="tablist" aria-label="Направление">
      <button
        type="button"
        role="tab"
        aria-selected={direction === 'en-ru'}
        className={'quiz-dir-btn' + (direction === 'en-ru' ? ' active' : '')}
        onClick={() => setDirection('en-ru')}
      >
        en-ru
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={direction === 'ru-en'}
        className={'quiz-dir-btn' + (direction === 'ru-en' ? ' active' : '')}
        onClick={() => setDirection('ru-en')}
      >
        ru-en
      </button>
    </div>
  )
}

// Progress bar + mastered counter, shared by Learn/Write.
function StudyProgress({ mastered, total }) {
  const pct = total ? Math.round((mastered / total) * 100) : 0
  return (
    <div className="study-progress">
      <div className="quiz-progress" style={{ width: '100%' }}>
        <div className="quiz-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="study-progress-label">Освоено {mastered} из {total}</span>
    </div>
  )
}

// Shared "session finished" result block.
function StudyDone({ label, onRestart }) {
  return (
    <div className="quiz quiz-result">
      <h2>{label}</h2>
      <p className="quiz-result-pct">Все карточки освоены 🎉</p>
      <button type="button" className="btn btn-primary" onClick={onRestart}>
        Начать заново
      </button>
    </div>
  )
}

// K6 LEARN (adaptive multiple choice) -------------------------------------------
function Learn({ set, id }) {
  const s = useStudySession(set, id)
  const { direction, setDirection, card, masteredCount, n, running } = s
  const [phase, setPhase] = useState('question')
  const [picked, setPicked] = useState(null)
  const [result, setResult] = useState(null) // 'correct' | 'wrong'

  const choices = useMemo(
    () => (card ? makeChoices(set.cards, s.idx, direction) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card, direction, s.idx]
  )

  const correct = card ? answerOf(card, direction) : ''
  const prompt = card ? (direction === 'en-ru' ? card.word : card.translation) : ''

  const choose = (val) => {
    if (phase !== 'question') return
    setPicked(val)
    const isCorrect = val === correct
    setResult(isCorrect ? 'correct' : 'wrong')
    s.applyResult(isCorrect)
    setPhase('feedback')
  }

  const next = () => {
    s.advance()
    setPhase('question')
    setPicked(null)
    setResult(null)
  }

  if (!running) {
    return <StudyDone label="Обучение завершено" onRestart={s.restart} />
  }

  return (
    <div className="quiz study">
      <StudyDirection direction={direction} setDirection={setDirection} />
      <StudyProgress mastered={masteredCount} total={n} />

      <div className="quiz-card">
        <span className="face-label">{direction === 'en-ru' ? 'EN · Слово' : 'RU · Перевод'}</span>
        <h2 className="quiz-word study-prompt">{prompt}</h2>
        <span className="study-status">{getStatus(id, s.idx)}</span>
      </div>

      <div className="quiz-choices">
        {choices.map((val, i) => {
          let cls = 'quiz-choice'
          if (phase === 'feedback' && val === correct) cls += ' correct'
          if (phase === 'feedback' && val === picked && val !== correct) cls += ' wrong'
          return (
            <button key={i} type="button" className={cls} disabled={phase === 'feedback'} onClick={() => choose(val)}>
              {val}
            </button>
          )
        })}
      </div>

      {phase === 'feedback' && (
        <>
          <div className={'study-feedback ' + result}>
            {result === 'correct' ? 'Верно!' : <>Неверно. Правильный ответ: <strong>{correct}</strong></>}
          </div>
          <button type="button" className="btn btn-primary quiz-next" onClick={next}>
            Далее
          </button>
        </>
      )}
    </div>
  )
}

// K6 WRITE (typed active recall) --------------------------------------------------
function Write({ set, id }) {
  const s = useStudySession(set, id)
  const { direction, setDirection, card, masteredCount, n, running } = s
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState('question')
  const [result, setResult] = useState(null)

  const prompt = card ? (direction === 'en-ru' ? card.word : card.translation) : ''
  const correct = card ? (direction === 'en-ru' ? card.translation : card.word) : ''

  const submit = (given) => {
    if (phase !== 'question') return
    const answer = (given === undefined ? input : given).trim().toLowerCase()
    const isCorrect = answer === correct.trim().toLowerCase()
    setResult(isCorrect ? 'correct' : 'wrong')
    s.applyResult(isCorrect)
    setPhase('feedback')
  }

  const next = () => {
    s.advance()
    setPhase('question')
    setInput('')
    setResult(null)
  }

  const onKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (phase === 'question') submit()
      else next()
    }
  }

  if (!running) {
    return <StudyDone label="Написание завершено" onRestart={s.restart} />
  }

  return (
    <div className="quiz study">
      <StudyDirection direction={direction} setDirection={setDirection} />
      <StudyProgress mastered={masteredCount} total={n} />

      <div className="quiz-card">
        <span className="face-label">{direction === 'en-ru' ? 'EN · Слово' : 'RU · Перевод'}</span>
        <h2 className="quiz-word study-prompt">{prompt}</h2>
      </div>

      <form className="write-form" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <input
          className="write-input"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck="false"
          placeholder="Введите ответ…"
          value={input}
          disabled={phase === 'feedback'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          autoFocus
        />
        {phase === 'question' && (
          <div className="write-actions">
            <button type="button" className="btn btn-primary" onClick={() => submit()}>
              Проверить
            </button>
            <button type="button" className="btn btn-outline" onClick={() => submit('')}>
              Не помню
            </button>
          </div>
        )}
      </form>

      {phase === 'feedback' && (
        <>
          <div className={'study-feedback ' + result}>
            {result === 'correct'
              ? `Верно! ${correct}`
              : <>Неверно. Правильный ответ: <strong>{correct}</strong></>}
          </div>
          <button type="button" className="btn btn-primary quiz-next" onClick={next}>
            Далее
          </button>
        </>
      )}
    </div>
  )
}

// K4 priority mode helpers ------------------------------------------------------
// Persisted mode across sessions: 'on' (sort by view count, default) / 'off'.
const PRIORITY_KEY = 'fc_priority_mode'

function readPriority() {
  return localStorage.getItem(PRIORITY_KEY) !== 'off' // default to 'on'
}

export default function SetPage() {
  const { id } = useParams()
  const [set] = useState(() => getSet(id))
  const [mode, setMode] = useState('cards')
  const [flipped, setFlipped] = useState(false)
  const [priority, setPriorityMode] = useState(readPriority)

  // Display order of card indices for the current pass of cards mode.
  // Computed once on entry / restart, then fixed for the whole pass.
  const [order, setOrder] = useState(() => {
    if (!set) return []
    const base = set.cards.map((_, i) => i)
    if (!readPriority()) return base
    const stats = getStats(id)
    // Stable sort in modern JS keeps equal-count cards in original order.
    return [...base].sort((a, b) => (stats[String(a)] || 0) - (stats[String(b)] || 0))
  })
  const [pos, setPos] = useState(0)

  const count = set ? set.cards.length : 0

  // Recompute the display order for a given priority mode (stable sort).
  const computeOrder = (usePriority) => {
    if (!set) return []
    const base = set.cards.map((_, i) => i)
    if (!usePriority) return base
    const stats = getStats(id)
    return [...base].sort((a, b) => (stats[String(a)] || 0) - (stats[String(b)] || 0))
  }

  // When switching INTO cards mode (e.g. from test), recompute a fresh pass.
  // Guard with the previous mode so this does NOT fire on the initial mount
  // (which would re-sort after the first view was already counted, changing the
  // order mid-pass). The pass order is otherwise fixed for its whole duration.
  const prevMode = useRef(mode)
  useEffect(() => {
    if (mode === 'cards' && prevMode.current !== 'cards') {
      setOrder(computeOrder(priority))
      setPos(0)
      setFlipped(false)
    }
    prevMode.current = mode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // The real card index currently displayed = order[pos] (display position).
  const currentIndex = set && order.length ? order[pos] : -1
  const current = set && currentIndex >= 0 ? set.cards[currentIndex] || null : null

  // Reused by restart / toggle with the same compute logic.
  const applyOrder = (usePriority) => {
    setOrder(computeOrder(usePriority))
    setPos(0)
    setFlipped(false)
  }

  // View counter: increments for the currently displayed ORIGINAL card index.
  useEffect(() => {
    if (currentIndex < 0 || !current) return
    recordCardView(id, currentIndex)
  }, [id, currentIndex, current])

  // "Заново": reset to the start of the pass and recompute the order once.
  const restart = () => applyOrder(priority)

  // Toggle priority mode; persists to localStorage and reorders immediately.
  const togglePriority = () => {
    const next = !priority
    setPriorityMode(next)
    localStorage.setItem(PRIORITY_KEY, next ? 'on' : 'off')
    applyOrder(next)
  }

  const goPrev = () => {
    setPos((p) => Math.max(p - 1, 0))
    setFlipped(false)
  }
  const goNext = () => {
    setPos((p) => Math.min(p + 1, count - 1))
    setFlipped(false)
  }

  // Hotkeys: ArrowLeft/ArrowRight = prev/next, Space = flip.
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setPos((p) => Math.min(p + 1, count - 1))
        setFlipped(false)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setPos((p) => Math.max(p - 1, 0))
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
          aria-selected={mode === 'learn'}
          className={'mode-btn' + (mode === 'learn' ? ' active' : '')}
          title="Адаптивное обучение"
          onClick={() => setMode('learn')}
        >
          Learn
          <span className="mode-k6">K6</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'write'}
          className={'mode-btn' + (mode === 'write' ? ' active' : '')}
          title="Активное припоминание"
          onClick={() => setMode('write')}
        >
          Write
          <span className="mode-k6">K6</span>
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

      {count === 0 ? (
        <div className="test-placeholder">
          <p>В этом наборе нет карточек.</p>
        </div>
      ) : mode === 'test' ? (
        <Quiz set={set} id={id} />
      ) : mode === 'learn' ? (
        <Learn set={set} id={id} />
      ) : mode === 'write' ? (
        <Write set={set} id={id} />
      ) : (
        <div className="deck">
          <div className="deck-toolbar">
            <label className="priority-toggle">
              <input
                type="checkbox"
                checked={priority}
                onChange={togglePriority}
              />
              <span>Приоритет повторения</span>
            </label>
            <button type="button" className="btn btn-outline" onClick={restart}>
              Заново
            </button>
          </div>

          <div className="flashcard-wrap">
            <span className="view-badge">Показов: {(getStats(id)[String(currentIndex)] || 0)}</span>
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
          </div>

          <div className="deck-controls">
            <button className="btn btn-outline" onClick={goPrev} disabled={pos === 0}>← Назад</button>
            <span className="deck-progress">Карточка {pos + 1} из {count}</span>
            <button className="btn btn-outline" onClick={goNext} disabled={pos === count - 1}>Вперёд →</button>
          </div>
        </div>
      )}
    </div>
  )
}
