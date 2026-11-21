import { useEffect, useRef, useState } from 'react'
import { fetchScreenCaptureImageBlob, listScreenCaptures } from '../../api/monitoring'
import { getErrorMessage } from '../../utils/apiError'
import { formatDateTimePKT } from '../../utils/dateFormat'

function formatOffset(offsetMs) {
  const seconds = Math.round(offsetMs / 1000)
  return `+${seconds} s`
}

// Screenshots of the candidate's screen taken while they were away from
// the exam ("Left Exam Screen" on exams that require screen sharing).
//
// The screenshots ARE the evidence for this violation (they show what the
// candidate opened), so they load as soon as the review opens and the
// first one is shown large. Every image fetch is still logged server-side
// as a view, because a screenshot can contain unrelated personal data.
export default function ScreenCaptureTimeline({ eventId }) {
  const [captures, setCaptures] = useState(null)
  const [error, setError] = useState('')
  const [images, setImages] = useState({})
  const [imageErrors, setImageErrors] = useState({})
  const [selectedId, setSelectedId] = useState(null)
  const objectUrls = useRef([])

  useEffect(() => {
    let cancelled = false
    listScreenCaptures(eventId)
      .then(async (items) => {
        if (cancelled) return
        setCaptures(items)
        setSelectedId(items[0]?.id ?? null)
        for (const capture of items) {
          try {
            const blob = await fetchScreenCaptureImageBlob(capture.id)
            if (cancelled) return
            const url = URL.createObjectURL(blob)
            objectUrls.current.push(url)
            setImages((current) => ({ ...current, [capture.id]: url }))
          } catch {
            if (!cancelled) setImageErrors((current) => ({ ...current, [capture.id]: true }))
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err, 'Unable to load the screen captures.'))
      })
    return () => {
      cancelled = true
    }
  }, [eventId])

  useEffect(
    () => () => {
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url))
    },
    [],
  )

  if (error) return <p className="text-danger small mb-0">{error}</p>
  if (captures === null) return <p className="text-muted small mb-0">Loading screen captures...</p>
  if (captures.length === 0) {
    return (
      <p className="text-muted small mb-0">
        No screen captures were received for this absence.
      </p>
    )
  }

  const selected = captures.find((capture) => capture.id === selectedId)

  return (
    <div className="screen-captures">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <span className="small text-muted">
          {captures.length} screenshot{captures.length === 1 ? '' : 's'} of what the student
          opened &middot; viewing is recorded
        </span>
      </div>

      <ol className="screen-captures__strip" aria-label="Screen captures, in the order they were taken">
        {captures.map((capture) => {
          const url = images[capture.id]
          return (
            <li key={capture.id}>
              <button
                type="button"
                className={`screen-captures__thumb${selectedId === capture.id ? ' screen-captures__thumb--selected' : ''}`}
                onClick={() => url && setSelectedId(capture.id)}
                disabled={!url}
                aria-label={`Screenshot ${capture.sequence}, ${formatOffset(capture.offset_ms)} after leaving`}
              >
                {url ? (
                  <img src={url} alt="" />
                ) : (
                  <span className="screen-captures__placeholder" aria-hidden="true">
                    {imageErrors[capture.id] ? 'Unavailable' : '…'}
                  </span>
                )}
              </button>
              <span className="screen-captures__offset">{formatOffset(capture.offset_ms)}</span>
            </li>
          )
        })}
      </ol>

      {selected && images[selected.id] && (
        <figure className="screen-captures__viewer mt-3 mb-0">
          <img src={images[selected.id]} alt={`Screenshot ${selected.sequence} of the candidate's screen`} />
          <figcaption className="small text-muted mt-1">
            Screenshot {selected.sequence} · {formatOffset(selected.offset_ms)} after leaving ·
            received {formatDateTimePKT(selected.captured_at)} · SHA-256{' '}
            <code title={selected.sha256}>{selected.sha256.slice(0, 12)}…</code>
          </figcaption>
        </figure>
      )}
    </div>
  )
}
