import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createExam,
  deleteExam,
  listExams,
  updateExam,
  updateExamStatus,
  uploadIspringPackage,
} from '../../api/exams'
import { getErrorMessage } from '../../utils/apiError'
import LoadingState from '../../components/LoadingState'
import ErrorState from '../../components/ErrorState'
import EmptyState from '../../components/EmptyState'
import ConfirmModal from '../../components/ConfirmModal'
import {
  EditIcon,
  ExamsIcon,
  FileIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  QuestionsIcon,
  SearchIcon,
  TrashIcon,
} from '../../components/admin/icons'
import PageHeader from '../../components/admin/PageHeader'
import FilterTabs from '../../components/admin/FilterTabs'
import TablePagination from '../../components/admin/TablePagination'
import RowActionsMenu from '../../components/admin/RowActionsMenu'
import { formatDatePKT } from '../../utils/dateFormat'
import { examStatusBadgeClass, examStatusLabel } from '../../utils/examStatus'

const EMPTY_FORM = {
  title: '',
  description: '',
  durationMinutes: '',
  contentType: 'native',
  // On by default: without screen sharing, leaving the exam screen can only
  // be evidenced by a camera photo, not by what the student opened.
  requireScreenShare: true,
}
// listExams() has no page/pageSize params -- it returns the full list --
// so pagination here is client-side only, over the already-loaded array,
// exactly like UsersPage.jsx's client-side pagination. No backend/API
// change involved.
const PAGE_SIZE = 10
const EXAM_STATUS_TABS = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'inactive', label: 'Inactive' },
]

// A native exam is only usable once it has questions; iSpring exams carry
// their questions in the uploaded package (the server checks that one).
function isEmptyNativeExam(exam) {
  return exam.content_type !== 'ispring' && exam.question_count === 0
}

export default function ExamManagementPage() {
  const navigate = useNavigate()
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [query, setQuery] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState('create')
  const [editingExamId, setEditingExamId] = useState(null)
  const [formValues, setFormValues] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [formSubmitting, setFormSubmitting] = useState(false)

  const [pendingAction, setPendingAction] = useState(null)
  const [actionError, setActionError] = useState('')
  const [actionSubmitting, setActionSubmitting] = useState(false)
  const [uploadExam, setUploadExam] = useState(null)
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadError, setUploadError] = useState('')
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listExams()
      setExams(data)
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to load exams right now.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Status tab + title search, applied to the already-loaded list.
  const normalizedQuery = query.trim().toLowerCase()
  const filteredExams = exams.filter(
    (exam) =>
      (!statusFilter || exam.status === statusFilter) &&
      (!normalizedQuery || exam.title.toLowerCase().includes(normalizedQuery)),
  )
  const totalPages = Math.max(1, Math.ceil(filteredExams.length / PAGE_SIZE))
  // Clamped separately from the raw `page` state so that deleting exams
  // while on the last page can never leave the view stuck on a page number
  // beyond what still exists (Exams, unlike Users, has a Delete action).
  const currentPage = Math.min(page, totalPages)
  const pageExams = filteredExams.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const handlePrevious = () => setPage((current) => Math.max(1, current - 1))
  const handleNext = () => setPage((current) => Math.min(totalPages, current + 1))

  const openCreateForm = () => {
    setFormMode('create')
    setEditingExamId(null)
    setFormValues(EMPTY_FORM)
    setFormError('')
    setFormOpen(true)
  }

  const openEditForm = (exam) => {
    setFormMode('edit')
    setEditingExamId(exam.id)
    setFormValues({
      title: exam.title,
      description: exam.description || '',
      durationMinutes: String(exam.duration_minutes),
      contentType: exam.content_type || 'native',
      requireScreenShare: Boolean(exam.require_screen_share),
    })
    setFormError('')
    setFormOpen(true)
  }

  const closeForm = () => {
    if (formSubmitting) return
    setFormOpen(false)
  }

  const handleFormSubmit = async () => {
    const title = formValues.title.trim()
    const durationMinutes = Number(formValues.durationMinutes)

    if (!title) {
      setFormError('Title is required.')
      return
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      setFormError('Duration must be a whole number of minutes greater than zero.')
      return
    }

    setFormSubmitting(true)
    setFormError('')
    try {
      if (formMode === 'create') {
        await createExam({
          title,
          description: formValues.description.trim(),
          durationMinutes,
          contentType: formValues.contentType,
          requireScreenShare: formValues.requireScreenShare,
        })
        setSuccessMessage('Exam created successfully.')
      } else {
        await updateExam(editingExamId, {
          title,
          description: formValues.description.trim(),
          durationMinutes,
          contentType: formValues.contentType,
          requireScreenShare: formValues.requireScreenShare,
        })
        setSuccessMessage('Exam updated successfully.')
      }
      setFormOpen(false)
      await load()
    } catch (err) {
      setFormError(getErrorMessage(err, 'Unable to save the exam right now.'))
    } finally {
      setFormSubmitting(false)
    }
  }

  const openPendingAction = (type, exam) => {
    setActionError('')
    setPendingAction({ type, exam })
  }

  const closePendingAction = () => {
    if (actionSubmitting) return
    setPendingAction(null)
    setActionError('')
  }

  const handleConfirmAction = async () => {
    if (!pendingAction) return
    setActionSubmitting(true)
    setActionError('')
    try {
      if (pendingAction.type === 'delete') {
        await deleteExam(pendingAction.exam.id)
        setSuccessMessage('Exam deleted successfully.')
      } else if (pendingAction.type === 'activate') {
        await updateExamStatus(pendingAction.exam.id, 'active')
        setSuccessMessage('Exam activated successfully.')
      } else if (pendingAction.type === 'deactivate') {
        await updateExamStatus(pendingAction.exam.id, 'inactive')
        setSuccessMessage('Exam deactivated successfully.')
      }
      setPendingAction(null)
      await load()
    } catch (err) {
      setActionError(getErrorMessage(err, 'Unable to complete this action right now.'))
    } finally {
      setActionSubmitting(false)
    }
  }

  const openUpload = (exam) => {
    setUploadExam(exam)
    setUploadFile(null)
    setUploadError('')
  }

  const handleUpload = async () => {
    if (!uploadFile) {
      setUploadError('Select the SCORM 1.2 ZIP exported by iSpring QuizMaker.')
      return
    }
    setUploading(true)
    setUploadError('')
    try {
      const uploaded = await uploadIspringPackage(uploadExam.id, uploadFile)
      setSuccessMessage(`iSpring package version ${uploaded.version} uploaded and validated.`)
      setUploadExam(null)
      await load()
    } catch (err) {
      setUploadError(getErrorMessage(err, 'Unable to validate and upload this package.'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Exam Management"
        subtitle="Create, organize, and manage your examinations."
        actions={
          <button
            type="button"
            className="btn btn-primary btn-sm d-inline-flex align-items-center gap-1"
            onClick={openCreateForm}
          >
            <PlusIcon width={16} height={16} />
            Create Exam
          </button>
        }
      />

      {successMessage && (
        <div
          className="alert alert-success d-flex justify-content-between align-items-start"
          role="alert"
        >
          <span>{successMessage}</span>
          <button
            type="button"
            className="btn-close"
            aria-label="Dismiss"
            onClick={() => setSuccessMessage('')}
          />
        </div>
      )}

      {loading && <LoadingState message="Loading exams..." />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && exams.length === 0 && (
        <EmptyState
          title="No exams yet"
          message="Create your first exam to get started."
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={openCreateForm}>
              Create Exam
            </button>
          }
        />
      )}

      {!loading && !error && exams.length > 0 && (
        <>
          <div className="filter-bar">
            <FilterTabs
              label="Filter exams by status"
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value)
                setPage(1)
              }}
              options={[
                { value: '', label: 'All', count: exams.length },
                ...EXAM_STATUS_TABS.map(({ value, label }) => ({
                  value,
                  label,
                  count: exams.filter((exam) => exam.status === value).length,
                })),
              ]}
            />
            <div className="filter-bar__controls">
              <div className="filter-bar__search">
                <SearchIcon width={16} height={16} className="filter-bar__search-icon" />
                <input
                  type="search"
                  className="form-control form-control-sm"
                  placeholder="Search exams by title"
                  aria-label="Search exams by title"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setPage(1)
                  }}
                />
              </div>
            </div>
          </div>

          {filteredExams.length === 0 ? (
            <div className="data-card">
              <EmptyState
                title="No matching exams"
                message="No exams match the current filter or search."
                action={
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => {
                      setStatusFilter('')
                      setQuery('')
                      setPage(1)
                    }}
                  >
                    Clear filters
                  </button>
                }
              />
            </div>
          ) : (
            <div className="data-card">
              <div className="table-responsive">
                <table className="data-table data-table--stack">
                  <thead>
                    <tr>
                      <th scope="col">Exam</th>
                      <th scope="col">Status</th>
                      <th scope="col">Format</th>
                      <th scope="col">Duration</th>
                      <th scope="col" className="data-table__optional">Created</th>
                      <th scope="col" className="data-table__actions">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageExams.map((exam) => {
                      const empty = isEmptyNativeExam(exam)
                      return (
                        <tr key={exam.id}>
                          <td className="data-table__lead">
                            <div className="exam-cell">
                              <span className="exam-cell__icon" aria-hidden="true">
                                <ExamsIcon width={18} height={18} />
                              </span>
                              <span style={{ minWidth: 0 }}>
                                <span className="exam-cell__title">{exam.title}</span>
                                {exam.description && (
                                  <span className="exam-cell__description" title={exam.description}>
                                    {exam.description}
                                  </span>
                                )}
                              </span>
                            </div>
                          </td>
                          <td data-label="Status">
                            <span>
                              <span className={`badge ${examStatusBadgeClass(exam.status)}`}>
                                {examStatusLabel(exam.status)}
                              </span>
                              {/* An active native exam with no questions would
                                  give students an empty paper -- flag it. */}
                              {exam.status === 'active' && empty && (
                                <span className="status-note status-note--danger">No questions</span>
                              )}
                            </span>
                          </td>
                          <td data-label="Format">
                            {exam.content_type === 'ispring' ? (
                              <span>
                                <span className="fw-semibold">iSpring</span>
                                <span className="status-note">
                                  {exam.ispring_package_uploaded
                                    ? `Package v${exam.ispring_package_version}`
                                    : 'Package required'}
                                </span>
                              </span>
                            ) : (
                              <span>
                                <span className="fw-semibold">Native</span>
                                <span className={`status-note${empty ? ' status-note--danger' : ''}`}>
                                  {exam.question_count} question{exam.question_count === 1 ? '' : 's'}
                                  {empty && exam.status !== 'active' && ' · add to activate'}
                                </span>
                              </span>
                            )}
                            {exam.require_screen_share && (
                              <span className="status-note">Screen sharing required</span>
                            )}
                          </td>
                          <td data-label="Duration" className="text-nowrap">
                            {exam.duration_minutes} min
                          </td>
                          <td data-label="Created" className="text-nowrap data-table__muted data-table__optional">
                            {formatDatePKT(exam.created_at)}
                          </td>
                          <td className="data-table__actions">
                            <span className="data-table__actions-inner">
                              {exam.content_type === 'ispring' ? (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
                                  onClick={() => openUpload(exam)}
                                  aria-label={`Upload quiz ZIP for ${exam.title}`}
                                  title="Upload quiz ZIP"
                                >
                                  <FileIcon width={14} height={14} />
                                  <span className="btn-label">Upload ZIP</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
                                  onClick={() => navigate(`/admin/exams/${exam.id}/questions`)}
                                  aria-label={`Questions for ${exam.title}`}
                                  title="Questions"
                                >
                                  <QuestionsIcon width={14} height={14} />
                                  <span className="btn-label">Questions</span>
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
                                onClick={() => openEditForm(exam)}
                                aria-label={`Edit ${exam.title}`}
                                title="Edit"
                              >
                                <EditIcon width={14} height={14} />
                                <span className="btn-label">Edit</span>
                              </button>
                              <RowActionsMenu
                                label={`More actions for ${exam.title}`}
                                items={[
                                  exam.status === 'active'
                                    ? {
                                        label: 'Deactivate',
                                        icon: <PauseIcon width={15} height={15} />,
                                        onSelect: () => openPendingAction('deactivate', exam),
                                      }
                                    : {
                                        label: 'Activate',
                                        icon: <PlayIcon width={15} height={15} />,
                                        disabled: empty,
                                        hint: empty ? 'Add at least one question first' : undefined,
                                        onSelect: () => openPendingAction('activate', exam),
                                      },
                                  {
                                    label: 'Delete exam',
                                    icon: <TrashIcon width={15} height={15} />,
                                    danger: true,
                                    onSelect: () => openPendingAction('delete', exam),
                                  },
                                ]}
                              />
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <TablePagination
                page={currentPage}
                totalPages={totalPages}
                total={filteredExams.length}
                pageSize={PAGE_SIZE}
                onPrevious={handlePrevious}
                onNext={handleNext}
              />
            </div>
          )}
        </>
      )}

      {formOpen && (
        <ConfirmModal
          title={formMode === 'create' ? 'Create Exam' : 'Edit Exam'}
          confirmLabel={
            formSubmitting ? 'Saving...' : formMode === 'create' ? 'Create Exam' : 'Save Changes'
          }
          confirmDisabled={formSubmitting}
          onConfirm={handleFormSubmit}
          onCancel={closeForm}
          size="lg"
        >
          <div className="row g-3 mb-3">
            <div className="col-md-8">
              <label htmlFor="exam-title" className="form-label fw-semibold">
                Title
              </label>
              <input
                id="exam-title"
                type="text"
                className="form-control"
                value={formValues.title}
                maxLength={150}
                disabled={formSubmitting}
                onChange={(e) => setFormValues((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="col-md-4">
              <label htmlFor="exam-duration" className="form-label fw-semibold">
                Duration (minutes)
              </label>
              <input
                id="exam-duration"
                type="number"
                min="1"
                className="form-control"
                value={formValues.durationMinutes}
                disabled={formSubmitting}
                onChange={(e) =>
                  setFormValues((f) => ({ ...f, durationMinutes: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="mb-3">
            <label htmlFor="exam-content-type" className="form-label fw-semibold">
              Exam content
            </label>
            <select
              id="exam-content-type"
              className="form-select"
              value={formValues.contentType}
              disabled={formSubmitting}
              onChange={(e) => setFormValues((f) => ({ ...f, contentType: e.target.value }))}
            >
              <option value="native">Exam Nigahban questions</option>
              <option value="ispring">iSpring QuizMaker (SCORM 1.2)</option>
            </select>
            {formValues.contentType === 'ispring' && (
              <div className="form-text">
                Save the exam, then upload the SCORM 1.2 ZIP before activating it.
              </div>
            )}
          </div>
          <div className="mb-3">
            <div className="form-check form-switch">
              <input
                id="exam-require-screen-share"
                className="form-check-input"
                type="checkbox"
                role="switch"
                checked={formValues.requireScreenShare}
                disabled={formSubmitting}
                onChange={(e) =>
                  setFormValues((f) => ({ ...f, requireScreenShare: e.target.checked }))
                }
                aria-describedby="exam-require-screen-share-help"
              />
              <label htmlFor="exam-require-screen-share" className="form-check-label fw-semibold">
                Require entire-screen sharing
              </label>
            </div>
            <div id="exam-require-screen-share-help" className="form-text">
              Students share their entire screen to take this exam (Chrome or Edge on a computer).
              If they leave the exam screen, screenshots of what they opened are attached to the
              violation. Nothing is captured while they stay on the exam. Turned off, the only
              evidence is a camera photo of the student.
            </div>
          </div>
          <div className="mb-3">
            <label htmlFor="exam-description" className="form-label fw-semibold">
              Description
            </label>
            <textarea
              id="exam-description"
              className="form-control"
              rows={4}
              value={formValues.description}
              disabled={formSubmitting}
              onChange={(e) => setFormValues((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          {formError && (
            <div className="alert alert-danger py-2 small mb-0" role="alert">
              {formError}
            </div>
          )}
        </ConfirmModal>
      )}

      {pendingAction && (
        <ConfirmModal
          title={
            pendingAction.type === 'delete'
              ? 'Delete Exam?'
              : pendingAction.type === 'activate'
                ? 'Activate Exam?'
                : 'Deactivate Exam?'
          }
          confirmLabel={
            actionSubmitting
              ? 'Working...'
              : pendingAction.type === 'delete'
                ? 'Delete Exam'
                : pendingAction.type === 'activate'
                  ? 'Activate'
                  : 'Deactivate'
          }
          confirmVariant={pendingAction.type === 'delete' ? 'danger' : 'primary'}
          confirmDisabled={actionSubmitting}
          onConfirm={handleConfirmAction}
          onCancel={closePendingAction}
        >
          {pendingAction.type === 'delete' && (
            <p>
              Are you sure you want to permanently delete{' '}
              <strong>{pendingAction.exam.title}</strong>? This cannot be undone.
            </p>
          )}
          {pendingAction.type === 'activate' && (
            <p>
              Activate <strong>{pendingAction.exam.title}</strong>? Students will be able to see
              and attempt it.
            </p>
          )}
          {pendingAction.type === 'deactivate' && (
            <p>
              Deactivate <strong>{pendingAction.exam.title}</strong>? Students will no longer be
              able to start it.
            </p>
          )}
          {actionError && (
            <div className="alert alert-danger py-2 small mb-0" role="alert">
              {actionError}
            </div>
          )}
        </ConfirmModal>
      )}

      {uploadExam && (
        <ConfirmModal
          title="Upload iSpring Quiz"
          confirmLabel={uploading ? 'Validating...' : 'Upload and Validate'}
          confirmDisabled={uploading}
          onConfirm={handleUpload}
          onCancel={() => !uploading && setUploadExam(null)}
        >
          <p className="small text-muted">
            In iSpring QuizMaker, publish the graded quiz using LMS → SCORM 1.2, then select the
            resulting ZIP. A new immutable version will be created for{' '}
            <strong>{uploadExam.title}</strong>.
          </p>
          <input
            type="file"
            className="form-control"
            accept=".zip,application/zip"
            disabled={uploading}
            onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
          />
          {uploadError && (
            <div className="alert alert-danger py-2 small mt-3 mb-0" role="alert">
              {uploadError}
            </div>
          )}
        </ConfirmModal>
      )}
    </div>
  )
}
