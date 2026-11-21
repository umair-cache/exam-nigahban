import { useCallback, useEffect, useRef, useState } from 'react'
import { createStudent, listStudents, updateStudent, updateStudentStatus } from '../../api/students'
import { createAdmin, listAdmins, updateAdminStatus } from '../../api/admins'
import { useAuth } from '../../context/AuthContext'
import { getErrorMessage } from '../../utils/apiError'
import LoadingState from '../../components/LoadingState'
import ErrorState from '../../components/ErrorState'
import EmptyState from '../../components/EmptyState'
import ConfirmModal from '../../components/ConfirmModal'
import CreateUserDialog from '../../components/admin/CreateUserDialog'
import {
  EditIcon,
  LockIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
} from '../../components/admin/icons'
import PageHeader from '../../components/admin/PageHeader'
import FilterTabs from '../../components/admin/FilterTabs'
import TablePagination from '../../components/admin/TablePagination'
import RowActionsMenu from '../../components/admin/RowActionsMenu'
import PersonCell from '../../components/admin/PersonCell'
import { accountStatusBadgeClass, accountStatusLabel, roleBadgeClass } from '../../utils/accountStatus'

const PAGE_SIZE = 10
// The two source endpoints each paginate independently server-side; a
// single merged Users table instead fetches one large page from each (the
// backend's own max) and paginates the merged result client-side. Safe for
// this system's realistic admin/student roster sizes without requiring any
// backend endpoint changes.
const SOURCE_PAGE_SIZE = 100

const EMPTY_EDIT_FORM = { fullName: '', department: '', className: '' }

function dash(value) {
  return value || <span className="text-muted">&mdash;</span>
}

function normalizeStudent(student) {
  return {
    key: `student-${student.id}`,
    // Students and admins are both rows in the users table, so its id gives
    // one creation order across the merged list.
    userId: student.user_id,
    role: 'student',
    name: student.full_name,
    idNumber: student.student_id,
    email: student.email,
    program: student.department,
    section: student.class_name,
    status: student.account_status,
    isSystemAdmin: false,
    raw: student,
  }
}

function normalizeAdmin(admin) {
  return {
    key: `admin-${admin.id}`,
    userId: admin.id,
    // The account's identity/display name -- admins have no separate
    // full_name unless one was set at creation (see backend
    // app/models/user.py), so fall back to username, exactly as the old
    // AdminManagementPage table already did.
    role: 'admin',
    name: admin.full_name || admin.username,
    idNumber: null,
    email: admin.email,
    program: null,
    section: null,
    status: admin.status,
    // The protected root account: badged in the table and its deactivate
    // control replaced by an explanation. The backend refuses the request
    // regardless (403) -- this only stops the UI offering an action that
    // cannot succeed.
    isSystemAdmin: Boolean(admin.is_system_admin),
    raw: admin,
  }
}

export default function UsersPage() {
  const { user: currentAdmin } = useAuth()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const searchTimer = useRef(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [createError, setCreateError] = useState('')

  const [editingRow, setEditingRow] = useState(null)
  const [editValues, setEditValues] = useState(EMPTY_EDIT_FORM)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState('')

  const [pendingAction, setPendingAction] = useState(null)
  const [actionError, setActionError] = useState('')
  const [actionSubmitting, setActionSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [studentsData, adminsData] = await Promise.all([
        listStudents({ search, page: 1, pageSize: SOURCE_PAGE_SIZE }),
        listAdmins({ search, page: 1, pageSize: SOURCE_PAGE_SIZE }),
      ])
      const merged = [
        ...studentsData.items.map(normalizeStudent),
        ...adminsData.items.map(normalizeAdmin),
      ].sort((a, b) => b.userId - a.userId) // newest account first
      setRows(merged)
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to load users right now.'))
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    load()
  }, [load])

  // Role tab and status are applied to the loaded rows; the text search
  // stays server-side (it narrows both source lists before they merge).
  const filteredRows = rows.filter(
    (row) =>
      (!roleFilter || row.role === roleFilter) &&
      (!statusFilter || (statusFilter === 'active') === Boolean(row.status)),
  )
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    clearTimeout(searchTimer.current)
    setSearch(searchInput.trim())
    setPage(1)
  }

  // Search as you type, after a short pause, so each keystroke does not
  // trigger a request. Enter still searches immediately.
  const handleSearchChange = (value) => {
    setSearchInput(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setSearch(value.trim())
      setPage(1)
    }, 350)
  }

  useEffect(() => () => clearTimeout(searchTimer.current), [])

  const handleClearFilters = () => {
    clearTimeout(searchTimer.current)
    setSearchInput('')
    setSearch('')
    setRoleFilter('')
    setStatusFilter('')
    setPage(1)
  }

  const handlePrevious = () => setPage((current) => Math.max(1, current - 1))
  const handleNext = () => setPage((current) => Math.min(totalPages, current + 1))

  const openCreate = () => {
    setCreateError('')
    setCreateOpen(true)
  }

  const closeCreate = () => {
    if (createSubmitting) return
    setCreateOpen(false)
  }

  const handleCreateSubmit = async (values) => {
    setCreateSubmitting(true)
    setCreateError('')
    try {
      if (values.role === 'student') {
        await createStudent({
          username: values.username,
          password: values.password,
          studentId: values.studentId,
          fullName: values.fullName,
          email: values.email,
          department: values.department,
          className: values.className,
        })
      } else {
        await createAdmin(values)
      }
      setSuccessMessage(
        values.role === 'student' ? 'Student created successfully.' : 'Admin created successfully.',
      )
      setCreateOpen(false)
      setPage(1)
      await load()
    } catch (err) {
      setCreateError(getErrorMessage(err, 'Unable to create the user right now.'))
    } finally {
      setCreateSubmitting(false)
    }
  }

  const openEdit = (row) => {
    setEditingRow(row)
    setEditValues({
      fullName: row.raw.full_name,
      department: row.raw.department || '',
      className: row.raw.class_name || '',
    })
    setEditError('')
  }

  const closeEdit = () => {
    if (editSubmitting) return
    setEditingRow(null)
  }

  const handleEditSubmit = async () => {
    const fullName = editValues.fullName.trim()
    if (!fullName) {
      setEditError('Full name is required.')
      return
    }
    setEditSubmitting(true)
    setEditError('')
    try {
      await updateStudent(editingRow.raw.id, {
        fullName,
        department: editValues.department.trim(),
        className: editValues.className.trim(),
      })
      setSuccessMessage('Student updated successfully.')
      setEditingRow(null)
      await load()
    } catch (err) {
      setEditError(getErrorMessage(err, 'Unable to update the student right now.'))
    } finally {
      setEditSubmitting(false)
    }
  }

  const openPendingAction = (type, row) => {
    setActionError('')
    setPendingAction({ type, row })
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
      const activate = pendingAction.type === 'activate'
      if (pendingAction.row.role === 'student') {
        await updateStudentStatus(pendingAction.row.raw.id, activate)
      } else {
        await updateAdminStatus(pendingAction.row.raw.id, activate)
      }
      setSuccessMessage(activate ? 'User activated successfully.' : 'User deactivated successfully.')
      setPendingAction(null)
      await load()
    } catch (err) {
      setActionError(getErrorMessage(err, 'Unable to complete this action right now.'))
    } finally {
      setActionSubmitting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Manage student and administrator accounts."
        actions={
          <button
            type="button"
            className="btn btn-primary btn-sm d-inline-flex align-items-center gap-1"
            onClick={openCreate}
          >
            <PlusIcon width={16} height={16} />
            Create User
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

      <div className="filter-bar">
        <FilterTabs
          label="Filter users by role"
          value={roleFilter}
          onChange={(value) => {
            setRoleFilter(value)
            setPage(1)
          }}
          options={[
            { value: '', label: 'All', count: rows.length },
            { value: 'student', label: 'Students', count: rows.filter((r) => r.role === 'student').length },
            { value: 'admin', label: 'Administrators', count: rows.filter((r) => r.role === 'admin').length },
          ]}
        />
        <div className="filter-bar__controls">
          <form className="filter-bar__search" role="search" onSubmit={handleSearchSubmit}>
            <SearchIcon width={16} height={16} className="filter-bar__search-icon" />
            <input
              id="user-search"
              type="search"
              className="form-control form-control-sm"
              placeholder="Search name, ID or username"
              aria-label="Search users by name, ID or username"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </form>
          <select
            className="form-select form-select-sm"
            aria-label="Filter users by account status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {loading && <LoadingState message="Loading users..." />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && filteredRows.length === 0 && (
        <div className="data-card">
          <EmptyState
            title="No users found"
            message={
              search || roleFilter || statusFilter
                ? 'No users match the current filters.'
                : 'Create your first user to get started.'
            }
            action={
              search || roleFilter || statusFilter ? (
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={handleClearFilters}
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        </div>
      )}

      {!loading && !error && filteredRows.length > 0 && (
        <div className="data-card">
          <div className="table-responsive">
            <table className="data-table data-table--stack">
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">ID No.</th>
                  <th scope="col">Role</th>
                  <th scope="col">Program &middot; Section</th>
                  <th scope="col" className="data-table__optional">Email</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="data-table__actions">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const isSelfAdmin =
                    row.role === 'admin' && currentAdmin && row.raw.id === currentAdmin.id
                  const lockReason = row.isSystemAdmin
                    ? 'Protected account — cannot be deactivated'
                    : isSelfAdmin
                      ? 'You cannot deactivate your own account'
                      : null
                  const programSection = [row.program, row.section].filter(Boolean).join(' · ')
                  return (
                    <tr key={row.key}>
                      <td className="data-table__lead">
                        <PersonCell
                          name={row.name}
                          secondary={row.raw.username ? `@${row.raw.username}` : null}
                          badge={
                            <>
                              {isSelfAdmin && (
                                <span className="badge text-bg-light text-dark border">You</span>
                              )}
                              {/* Marks the protected root account. Shown rather
                                  than hidden: a control disabled for a stated
                                  reason reads as intentional. */}
                              {row.isSystemAdmin && (
                                <span className="badge text-bg-dark">System Admin</span>
                              )}
                            </>
                          }
                        />
                      </td>
                      <td data-label="ID No.">{dash(row.idNumber)}</td>
                      <td data-label="Role">
                        <span className={`badge ${roleBadgeClass(row.role)}`}>
                          {row.role === 'admin' ? 'Admin' : 'Student'}
                        </span>
                      </td>
                      <td data-label="Program · Section">{dash(programSection)}</td>
                      <td data-label="Email" className="data-table__optional data-table__muted">
                        {dash(row.email)}
                      </td>
                      <td data-label="Status">
                        <span className={`badge ${accountStatusBadgeClass(row.status)}`}>
                          {accountStatusLabel(row.status)}
                        </span>
                      </td>
                      <td className="data-table__actions">
                        <span className="data-table__actions-inner">
                          {row.role === 'student' && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
                              onClick={() => openEdit(row)}
                              aria-label={`Edit ${row.name}`}
                              title="Edit"
                            >
                              <EditIcon width={14} height={14} />
                              <span className="btn-label">Edit</span>
                            </button>
                          )}
                          {lockReason ? (
                            <span
                              className="row-menu__trigger text-muted"
                              title={lockReason}
                              aria-label={lockReason}
                              role="img"
                            >
                              <LockIcon width={16} height={16} />
                            </span>
                          ) : (
                            <RowActionsMenu
                              label={`More actions for ${row.name}`}
                              items={[
                                row.status
                                  ? {
                                      label: 'Deactivate account',
                                      icon: <PauseIcon width={15} height={15} />,
                                      hint: 'Blocks sign-in until reactivated',
                                      onSelect: () => openPendingAction('deactivate', row),
                                    }
                                  : {
                                      label: 'Activate account',
                                      icon: <PlayIcon width={15} height={15} />,
                                      onSelect: () => openPendingAction('activate', row),
                                    },
                              ]}
                            />
                          )}
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
            total={filteredRows.length}
            pageSize={PAGE_SIZE}
            onPrevious={handlePrevious}
            onNext={handleNext}
          />
        </div>
      )}

      {createOpen && (
        <CreateUserDialog
          submitting={createSubmitting}
          error={createError}
          onSubmit={handleCreateSubmit}
          onCancel={closeCreate}
        />
      )}

      {editingRow && (
        <ConfirmModal
          title={`Edit ${editingRow.name}`}
          confirmLabel={editSubmitting ? 'Saving...' : 'Save Changes'}
          confirmDisabled={editSubmitting}
          onConfirm={handleEditSubmit}
          onCancel={closeEdit}
          size="lg"
        >
          <div className="row g-3 mb-3">
            <div className="col-12">
              <label htmlFor="edit-user-full-name" className="form-label fw-semibold">
                Full Name
              </label>
              <input
                id="edit-user-full-name"
                type="text"
                className="form-control"
                maxLength={150}
                value={editValues.fullName}
                disabled={editSubmitting}
                onChange={(e) => setEditValues((f) => ({ ...f, fullName: e.target.value }))}
              />
            </div>
          </div>
          <div className="row g-3 mb-3">
            <div className="col-md-6">
              <label htmlFor="edit-user-program" className="form-label fw-semibold">
                Program
              </label>
              <input
                id="edit-user-program"
                type="text"
                className="form-control"
                value={editValues.department}
                disabled={editSubmitting}
                onChange={(e) => setEditValues((f) => ({ ...f, department: e.target.value }))}
              />
            </div>
            <div className="col-md-6">
              <label htmlFor="edit-user-section" className="form-label fw-semibold">
                Section
              </label>
              <input
                id="edit-user-section"
                type="text"
                className="form-control"
                value={editValues.className}
                disabled={editSubmitting}
                onChange={(e) => setEditValues((f) => ({ ...f, className: e.target.value }))}
              />
            </div>
          </div>
          {editError && (
            <div className="alert alert-danger py-2 small mb-0" role="alert">
              {editError}
            </div>
          )}
        </ConfirmModal>
      )}

      {pendingAction && (
        <ConfirmModal
          title={pendingAction.type === 'activate' ? 'Activate User?' : 'Deactivate User?'}
          confirmLabel={
            actionSubmitting ? 'Working...' : pendingAction.type === 'activate' ? 'Activate' : 'Deactivate'
          }
          confirmDisabled={actionSubmitting}
          onConfirm={handleConfirmAction}
          onCancel={closePendingAction}
        >
          {pendingAction.type === 'activate' ? (
            <p>
              Activate <strong>{pendingAction.row.name}</strong>? They will be able to log in again.
            </p>
          ) : (
            <p>
              Deactivate <strong>{pendingAction.row.name}</strong>? They will no longer be able to log
              in.
            </p>
          )}
          {actionError && (
            <div className="alert alert-danger py-2 small mb-0" role="alert">
              {actionError}
            </div>
          )}
        </ConfirmModal>
      )}
    </div>
  )
}
