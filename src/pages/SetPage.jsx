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

// All selectable test question types (K7).
const QUESTION_TYPES = [
  { id: 'choice', label: 'Выбор ответа', desc: 'Вопрос + 4 варианта' },
  { id: 'typed', label: 'Ввод ответа', desc: 'Напечатать ответ с клавиатуры' },
  { id: 'matching', label: 'Сопоставление', desc: 'Соединить термины с переводами' },
  { id: 'tf', label: 'Правда/ложь', desc: 'Соответствуют ли слово и перевод' },
]

const ALL_TYPES = QUESTION_TYPES.map((t) => t.id)

// Build the prompt/answer side pair for a card under a given direction.
function sidesOf(card, direction) {
  return {
    q: direction === 'en-ru' ? card.word : card.translation,
    a: direction === 'en-ru' ? card.translation : card.word,
  }
}

// Random pick from an array.
function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Build one question of a random selected type around a primary card index.
function buildQuestion(cards, cfg, cardIndex) {
  const dir = cfg.direction
  const types = cfg.types.length ? cfg.types : ALL_TYPES
  const type = pickOne(types)
  const card = cards[cardIndex]

  if (type === 'choice') {
    const { q, a } = sidesOf(card, dir)
    return { type, cardIndex, prompt: q, correct: a, choices: makeChoices(cards, cardIndex, dir) }
  }

  if (type === 'typed') {
    const { q, a } = sidesOf(card, dir)
    return { type, cardIndex, prompt: q, correct: a }
  }

  if (type === 'tf') {
    const { q } = sidesOf(card, dir)
    const truthful = Math.random() < 0.5
    const other = pickOne(cards.filter((_, i) => i !== cardIndex))
    const presented = truthful ? sidesOf(card, dir).a : sidesOf(other, dir).a
    return { type, cardIndex, prompt: q, presented, correct: truthful }
  }

  // matching: 4-6 terms on the left, shuffled answers on the right
  const mkLabel = (i) => (dir === 'en-ru' ? cards[i].word : cards[i].translation)
  const mkAnswer = (i) => (dir === 'en-ru' ? cards[i].translation : cards[i].word)
  const mcount = Math.min(6, Math.max(2, cards.length))
  const idxs = [cardIndex]
  const rest = shuffle(cards.map((_, i) => i).filter((i) => i !== cardIndex))
  for (const i of rest) {
    if (idxs.length >= mcount) break
    idxs.push(i)
  }
  const left = shuffle(idxs).map((i) => ({ idx: i, label: mkLabel(i) }))
  const right = shuffle(idxs.map((i) => ({ idx: i, label: mkAnswer(i) })))
  return { type, cardIndex, left, right, pairs: {} }
}

// K7 EXTENDED TEST -----------------------------------------------------------
// Configurable question types (choice/typed/matching/true-false), direction,
// question count and optional timer, with a score + error-breakdown result
// screen and a retry-on-errors pass.
function ExtendedTest({ set, id }) {
  const cards = set.cards
  const n = cards.length

  const [cfg, setCfg] = useState({
    types: [...ALL_TYPES],
    direction: 'en-ru',
    count: 'all', // 'all' | 'n'
    countN: Math.min(5, n),
    enableTimer: false,
    minutes: 5,
  })
  const [started, setStarted] = useState(false)
  const [run, setRun] = useState(null) // { pool, pos, target, score, wrong, streaks, done }
  const [question, setQuestion] = useState(null)
  const [feedback, setFeedback] = useState(false)
  const [pairs, setPairs] = useState({}) // matching: leftIdx -> rightIdx
  const [selLeft, setSelLeft] = useState(null) // matching: selected left idx
  const [secondsLeft, setSecondsLeft] = useState(null)

  const done = run ? run.done : false

  const makeQuestion = (pool, pos) => buildQuestion(cards, cfg, pool[pos])

  const start = () => {
    const allIdx = shuffle(cards.map((_, i) => i))
    const pool = cfg.count === 'all' ? allIdx : allIdx.slice(0, Math.min(cfg.countN, n))
    setRun({ pool, pos: 0, target: pool.length, score: 0, wrong: [], streaks: {}, done: false })
    setQuestion(makeQuestion(pool, 0))
    setSecondsLeft(cfg.enableTimer ? cfg.minutes * 60 : null)
    setFeedback(false)
    setPairs({})
    setSelLeft(null)
    setStarted(true)
  }

  // Optional countdown: when it hits zero, auto-finish the test.
  useEffect(() => {
    if (!started || !cfg.enableTimer || done || secondsLeft === null) return
    if (secondsLeft <= 0) {
      setRun((r) => ({ ...r, pos: r.target, done: true }))
      return
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [started, cfg.enableTimer, done, secondsLeft])

  // Apply the correct/wrong result of one answer to streaks + persistent status.
  const applyResult = (cardIndex, correct) => {
    setRun((r) => {
      const streaks = { ...r.streaks }
      const prev = streaks[String(cardIndex)] || 0
      const next = correct ? prev + 1 : 0
      streaks[String(cardIndex)] = next
      if (correct) setCardStatus(id, cardIndex, next >= 2 ? 'mastered' : 'learning')
      else setCardStatus(id, cardIndex, 'learning')
      return { ...r, streaks }
    })
  }

  const recordWrong = (entry) => {
    setRun((r) => ({ ...r, wrong: [...r.wrong, entry] }))
  }

  const finishAnswer = (cardIndex, correct, wrongEntry) => {
    setRun((r) => ({ ...r, score: r.score + (correct ? 1 : 0) }))
    applyResult(cardIndex, correct)
    if (!correct) recordWrong(wrongEntry)
    setFeedback(true)
  }

  const next = () => {
    const nextPos = run.pos + 1
    setRun((r) => ({ ...r, pos: nextPos, done: nextPos >= r.target }))
    setQuestion(makeQuestion(run.pool, nextPos))
    setFeedback(false)
    setPairs({})
    setSelLeft(null)
  }

  const retryWrong = () => {
    const wrongIdxs = run.wrong.map((w) => w.cardIndex)
    if (!wrongIdxs.length) return
    setRun({ pool: wrongIdxs, pos: 0, target: wrongIdxs.length, score: 0, wrong: [], streaks: {}, done: false })
    setQuestion(makeQuestion(wrongIdxs, 0))
    setSecondsLeft(null)
    setFeedback(false)
    setPairs({})
    setSelLeft(null)
  }

  // Matching counts as a single question: 1 point when every pair is correct.
  // Wrong pairs still get recorded for the error breakdown + retry (
  // and update statuses per involved card).
  const finishMatching = (correctIdxs, wrongEntries) => {
    setRun((r) => ({
      ...r,
      score: r.score + (wrongEntries.length ? 0 : 1),
      wrong: [...r.wrong, ...wrongEntries],
    }))
    correctIdxs.forEach((i) => applyResult(i, true))
    wrongEntries.forEach((w) => applyResult(w.cardIndex, false))
    setFeedback(true)
  }

  const restart = () => {
    setStarted(false)
    setRun(null)
    setQuestion(null)
    setFeedback(false)
    setSecondsLeft(null)
  }

  // ---- Settings screen (before start) ----
  if (!started) {
    const toggleType = (tid) =>
      setCfg((c) => ({
        ...c,
        types: c.types.includes(tid) ? c.types.filter((t) => t !== tid) : [...c.types, tid],
      }))
    return (
      <div className="quiz test-settings">
        <h2 className="settings-title">Настройки теста</h2>

        <fieldset className="settings-block">
          <legend>Типы вопросов</legend>
          {QUESTION_TYPES.map((t) => (
            <label className="settings-check" key={t.id}>
              <input
                type="checkbox"
                checked={cfg.types.includes(t.id)}
                onChange={() => toggleType(t.id)}
              />
              <span className="settings-check-name">{t.label}</span>
              <span className="settings-check-desc">{t.desc}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="settings-block">
          <legend>Направление</legend>
          <div className="quiz-direction">
            <button
              type="button"
              role="tab"
              aria-selected={cfg.direction === 'en-ru'}
              className={'quiz-dir-btn' + (cfg.direction === 'en-ru' ? ' active' : '')}
              onClick={() => setCfg((c) => ({ ...c, direction: 'en-ru' }))}
            >
              en-ru
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={cfg.direction === 'ru-en'}
              className={'quiz-dir-btn' + (cfg.direction === 'ru-en' ? ' active' : '')}
              onClick={() => setCfg((c) => ({ ...c, direction: 'ru-en' }))}
            >
              ru-en
            </button>
          </div>
        </fieldset>

        <fieldset className="settings-block">
          <legend>Количество вопросов</legend>
          <div className="settings-row">
            <label className="settings-radio">
              <input
                type="radio"
                name="qcount"
                checked={cfg.count === 'all'}
                onChange={() => setCfg((c) => ({ ...c, count: 'all' }))}
              />
              Все <span className="muted">({n})</span>
            </label>
            <label className="settings-radio">
              <input
                type="radio"
                name="qcount"
                checked={cfg.count === 'n'}
                onChange={() => setCfg((c) => ({ ...c, count: 'n' }))}
              />
              Только
              <input
                type="number"
                min="1"
                max={n}
                className="settings-num"
                value={cfg.countN}
                disabled={cfg.count !== 'n'}
                onChange={(e) => setCfg((c) => ({ ...c, countN: Number(e.target.value) }))}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="settings-block">
          <legend>Ограничение по времени</legend>
          <div className="settings-row">
            <label className="settings-check inline">
              <input
                type="checkbox"
                checked={cfg.enableTimer}
                onChange={() => setCfg((c) => ({ ...c, enableTimer: !c.enableTimer }))}
              />
              <span>Включить таймер</span>
            </label>
            <input
              type="number"
              min="1"
              className="settings-num"
              value={cfg.minutes}
              disabled={!cfg.enableTimer}
              onChange={(e) => setCfg((c) => ({ ...c, minutes: Number(e.target.value) }))}
            />
            <span className="muted">мин</span>
          </div>
        </fieldset>

        <button type="button" className="btn btn-primary settings-start" onClick={start}>
          Начать тест
        </button>
      </div>
    )
  }

  // ---- Result screen ----
  if (done) {
    const target = run.target
    const pct = target ? Math.round((run.score / target) * 100) : 0
    return (
      <div className="quiz quiz-result">
        <h2>Тест завершён</h2>
        <p className="quiz-result-score">{run.score} из {target} верно</p>
        <p className="quiz-result-pct">{pct}%</p>

        {run.wrong.length > 0 && (
          <div className="result-errors">
            <h3>Ошибки</h3>
            <ul>
              {run.wrong.map((w, i) => (
                <li key={i}>
                  <span className="re-prompt">{w.prompt}</span>
                  <span className="re-arrow">→</span>
                  <span className="re-correct">{w.correct}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="result-actions">
          {run.wrong.length > 0 && (
            <button type="button" className="btn btn-primary" onClick={retryWrong}>
              Повторить ошибочные
            </button>
          )}
          <button type="button" className="btn btn-outline" onClick={restart}>
            Начать заново
          </button>
        </div>
      </div>
    )
  }

  const q = question
  const progress = run.target ? Math.min(run.pos / run.target, 1) : 0
  const mm = String(Math.floor((secondsLeft || 0) / 60)).padStart(2, '0')
  const ss = String((secondsLeft || 0) % 60).padStart(2, '0')

  return (
    <div className="quiz">
      <div className="quiz-meta">
        <span className="quiz-score">{run.score} / {run.pos} правильных</span>
        <span className="quiz-count">Вопрос {run.pos + 1} из {run.target}</span>
        {cfg.enableTimer && (
          <span className="quiz-timer" data-testid="quiz-timer">⏱ {mm}:{ss}</span>
        )}
      </div>
      <div className="quiz-progress">
        <div className="quiz-progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      {q.type === 'choice' && (
        <ChoiceQuestion q={q} feedback={feedback} onAnswer={(cardIndex, correct, wrongEntry) => finishAnswer(cardIndex, correct, wrongEntry)} />
      )}
      {q.type === 'typed' && (
        <TypedQuestion q={q} feedback={feedback} onAnswer={finishAnswer} />
      )}
      {q.type === 'matching' && (
        <MatchingQuestion
          q={q}
          feedback={feedback}
          pairs={pairs}
          setPairs={setPairs}
          selLeft={selLeft}
          setSelLeft={setSelLeft}
          onCheck={finishMatching}
        />
      )}
      {q.type === 'tf' && (
        <TfQuestion q={q} feedback={feedback} onAnswer={finishAnswer} />
      )}

      {feedback && (
        <button type="button" className="btn btn-primary quiz-next" onClick={next}>
          Далее
        </button>
      )}
    </div>
  )
}

// Multiple choice question (classic K3 style + options).
function ChoiceQuestion({ q, feedback, onAnswer }) {
  const [picked, setPicked] = useState(null)
  const answer = (val) => {
    if (feedback) return
    setPicked(val)
    const correct = val === q.correct
    onAnswer(q.cardIndex, correct, { cardIndex: q.cardIndex, type: q.type, prompt: q.prompt, correct: q.correct })
  }
  return (
    <>
      <div className="quiz-card">
        <span className="face-label">Выбор ответа</span>
        <h2 className="quiz-word">{q.prompt}</h2>
      </div>
      <div className="quiz-choices">
        {q.choices.map((val, i) => {
          let cls = 'quiz-choice'
          if (feedback && val === q.correct) cls += ' correct'
          if (feedback && val === picked && val !== q.correct) cls += ' wrong'
          return (
            <button key={i} type="button" className={cls} disabled={feedback} onClick={() => answer(val)}>
              {val}
            </button>
          )
        })}
      </div>
    </>
  )
}

// Typed active-recall question.
function TypedQuestion({ q, feedback, onAnswer }) {
  const [input, setInput] = useState('')
  const submit = () => {
    if (feedback) return
    const given = input.trim().toLowerCase()
    const correct = given === q.correct.trim().toLowerCase()
    onAnswer(q.cardIndex, correct, { cardIndex: q.cardIndex, type: q.type, prompt: q.prompt, correct: q.correct })
  }
  return (
    <>
      <div className="quiz-card">
        <span className="face-label">Ввод ответа</span>
        <h2 className="quiz-word">{q.prompt}</h2>
      </div>
      <form
        className="write-form"
        onSubmit={(e) => { e.preventDefault(); submit() }}
      >
        <input
          className="write-input"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck="false"
          placeholder="Введите ответ…"
          value={input}
          disabled={feedback}
          onChange={(e) => setInput(e.target.value)}
          data-testid="typed-input"
        />
        {!feedback && (
          <div className="write-actions">
            <button type="button" className="btn btn-primary" onClick={submit}>
              Проверить
            </button>
          </div>
        )}
      </form>
      {feedback && (
        <div className={'study-feedback ' + (input.trim().toLowerCase() === q.correct.trim().toLowerCase() ? 'correct' : 'wrong')}>
          {input.trim().toLowerCase() === q.correct.trim().toLowerCase()
            ? 'Верно!'
            : <>Неверно. Правильный ответ: <strong>{q.correct}</strong></>}
        </div>
      )}
    </>
  )
}

// True/false question: does the shown word match its translation?
function TfQuestion({ q, feedback, onAnswer }) {
  const [picked, setPicked] = useState(null)
  const answer = (val) => {
    if (feedback) return
    setPicked(val)
    const correct = val === q.correct
    onAnswer(q.cardIndex, correct, { cardIndex: q.cardIndex, type: q.type, prompt: q.prompt, correct: `${q.prompt} = ${q.presented}` })
  }
  return (
    <>
      <div className="quiz-card">
        <span className="face-label">Правда/ложь</span>
        <h2 className="quiz-word">{q.prompt}</h2>
        <p className="tf-statement">{q.presented}</p>
      </div>
      <div className="tf-actions">
        <button type="button" className={'tf-btn' + (picked === true ? ' picked' : '')} disabled={feedback} onClick={() => answer(true)}>
          ✔ Да
        </button>
        <button type="button" className={'tf-btn' + (picked === false ? ' picked' : '')} disabled={feedback} onClick={() => answer(false)}>
          ✘ Нет
        </button>
      </div>
      {feedback && picked !== null && (
        <div className={'study-feedback ' + (picked === q.correct ? 'correct' : 'wrong')}>
          {picked === q.correct ? 'Верно!' : <>Неверно. Ответ: <strong>{q.correct ? 'Да' : 'Нет'}</strong></>}
        </div>
      )}
    </>
  )
}

// Matching question: pair terms on the left with shuffled translations on the
// right by clicking a left item then a right item, then finalize.
function MatchingQuestion({ q, feedback, pairs, setPairs, selLeft, setSelLeft, onCheck }) {
  const [matchedCorrect, setMatchedCorrect] = useState(0)
  const leftAllPaired = q.left.every((l) => pairs[l.idx] !== undefined)
  const check = () => {
    if (feedback) return
    let correctCount = 0
    const correctIdxs = []
    const wrongEntries = []
    for (const l of q.left) {
      const rIdx = pairs[l.idx]
      if (rIdx === undefined) continue
      if (l.idx === rIdx) {
        correctCount += 1
        correctIdxs.push(l.idx)
      } else {
        wrongEntries.push({ cardIndex: l.idx, type: 'matching', prompt: l.label, correct: q.right.find((r) => r.idx === l.idx).label })
      }
    }
    setMatchedCorrect(correctCount)
    onCheck(correctIdxs, wrongEntries)
    setSelLeft(null)
  }
  return (
    <>
      <div className="quiz-card match-head">
        <span className="face-label">Сопоставление</span>
        <p className="match-desc">{q.left.length} пар. Нажмите слева, затем справа.</p>
      </div>
      <div className="match-board">
        {q.left.map((l) => {
          const matched = pairs[l.idx]
          const isSel = selLeft === l.idx
          let cls = 'match-item left' + (isSel ? ' selected' : '') + (matched !== undefined ? ' matched' : '')
          if (feedback && matched !== undefined) cls += matched === l.idx ? ' ok' : ' bad'
          return (
            <button
              key={'L' + l.idx}
              type="button"
              className={cls}
              data-cardidx={l.idx}
              disabled={feedback}
              onClick={() => setSelLeft(isSel ? null : l.idx)}
            >
              <span className="match-label">{l.label}</span>
              {matched !== undefined && (
                <span className="match-link">→ {q.right.find((r) => r.idx === matched).label}</span>
              )}
            </button>
          )
        })}

        {q.right.map((r) => {
          const usedBy = Object.keys(pairs).find((k) => pairs[k] === r.idx)
          let cls = 'match-item right' + (usedBy !== undefined ? ' used' : '')
          if (feedback && usedBy !== undefined) cls += String(r.idx) === usedBy ? ' ok' : ' bad'
          return (
            <button
              key={'R' + r.idx}
              type="button"
              className={cls}
              data-cardidx={r.idx}
              disabled={feedback || usedBy !== undefined}
              onClick={() => {
                if (selLeft === null) return
                setPairs((p) => ({ ...p, [selLeft]: r.idx }))
                setSelLeft(null)
              }}
            >
              <span className="match-label">{r.label}</span>
            </button>
          )
        })}
      </div>
      {!feedback && leftAllPaired && (
        <button type="button" className="btn btn-primary quiz-next" onClick={check}>
          Проверить пары
        </button>
      )}
      {feedback && (
        <div className="study-feedback matching-feedback">
          Правильных пар: {matchedCorrect} из {q.left.length}
        </div>
      )}
    </>
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

// K7 SPELL (audio + typed spelling) -------------------------------------------
// Speak the English word via the Web Speech API and have the user type it back.
// Picks an en voice when available; degrades gracefully (try/catch) if speech
// synthesis is unavailable (e.g. headless Chromium) so typing still works.
let _speechVoices = []
function loadVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  try {
    _speechVoices = window.speechSynthesis.getVoices()
  } catch (e) {
    _speechVoices = []
  }
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  loadVoices()
  try { window.speechSynthesis.onvoiceschanged = loadVoices } catch (e) { /* ignore */ }
}

function speakEnglish(text) {
  if (typeof window === 'undefined' || !window.speechSynthesis || !text) return
  try {
    const synth = window.speechSynthesis
    synth.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    const en =
      _speechVoices.find((v) => /^en/i.test(v.lang)) ||
      _speechVoices.find((v) => /\ben(?:[-_]|$)/i.test(v.lang)) ||
      _speechVoices.find((v) => /en/i.test(v.name)) ||
      null
    if (en) utter.voice = en
    utter.lang = 'en-US'
    synth.speak(utter)
  } catch (e) {
    // speech unavailable -> UI still works, user can type the word
  }
}

// K7 SPELL mode: hear the word, type it letter-by-letter. Reuses the adaptive
// session machine so statuses follow the same correct-2x->mastered semantics.
function Spell({ set, id }) {
  const s = useStudySession(set, id)
  const { card, masteredCount, n, running } = s
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState('question')
  const [result, setResult] = useState(null)

  const word = card ? card.word : ''
  const hint = card ? card.word.charAt(0) : ''
  const correct = card ? card.word : ''

  // Speak each new word as it appears (and on repeat via the button).
  useEffect(() => {
    if (running && word) speakEnglish(word)
  }, [running, word])

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
    return <StudyDone label="Spell завершён" onRestart={s.restart} />
  }

  return (
    <div className="quiz study spell">
      <StudyProgress mastered={masteredCount} total={n} />

      <div className="quiz-card">
        <span className="face-label">Spell · Наберите услышанное слово</span>
        <h2 className="quiz-word spell-speaker">🔊</h2>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => speakEnglish(word)}
          data-testid="spell-repeat"
        >
          Повторить озвучку
        </button>
        {phase === 'question' && <span className="spell-hint">Первая буква: <strong>{hint}</strong></span>}
      </div>

      <form className="write-form" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <input
          className="write-input"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck="false"
          placeholder="Введите слово…"
          value={input}
          disabled={phase === 'feedback'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          data-testid="spell-input"
          data-answer={correct}
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
              : <>Неверно. Правильное слово: <strong>{correct}</strong></>}
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
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'spell'}
          className={'mode-btn' + (mode === 'spell' ? ' active' : '')}
          title="Написание на слух"
          onClick={() => setMode('spell')}
        >
          Spell
          <span className="mode-k7">K7</span>
        </button>
      </div>

      {count === 0 ? (
        <div className="test-placeholder">
          <p>В этом наборе нет карточек.</p>
        </div>
      ) : mode === 'test' ? (
        <ExtendedTest set={set} id={id} />
      ) : mode === 'spell' ? (
        <Spell set={set} id={id} />
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
