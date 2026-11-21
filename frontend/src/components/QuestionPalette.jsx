// Question navigator. Colour shows whether a question is answered; the
// current question gets a ring instead of its own colour, so "answered"
// stays visible while you're on it.
export default function QuestionPalette({ questions, currentIndex, answeredIds, onSelect }) {
  return (
    <>
      <div className="question-palette" role="group" aria-label="Question navigation">
        {questions.map((question, index) => {
          const isAnswered = answeredIds.has(question.id)
          const isCurrent = index === currentIndex
          const variant = isAnswered ? 'btn-success' : 'btn-outline-secondary'
          const status = isAnswered ? 'answered' : 'unanswered'
          return (
            <button
              key={question.id}
              type="button"
              className={`btn btn-sm question-palette__btn ${variant}${
                isCurrent ? ' question-palette__btn--current' : ''
              }`}
              onClick={() => onSelect(index)}
              aria-current={isCurrent ? 'true' : undefined}
              aria-label={`Question ${index + 1}, ${status}`}
            >
              {index + 1}
            </button>
          )
        })}
      </div>
      <ul className="question-palette__legend" aria-hidden="true">
        <li>
          <span className="question-palette__swatch question-palette__swatch--answered" />
          Answered
        </li>
        <li>
          <span className="question-palette__swatch" />
          Unanswered
        </li>
        <li>
          <span className="question-palette__swatch question-palette__swatch--current" />
          Current
        </li>
      </ul>
    </>
  )
}
