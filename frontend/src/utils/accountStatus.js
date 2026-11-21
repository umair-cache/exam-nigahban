// User account status and role -> badge class and label, shared by the
// admin user screens.
export function accountStatusBadgeClass(isActive) {
  return isActive ? 'text-bg-success' : 'text-bg-warning'
}

export function accountStatusLabel(isActive) {
  return isActive ? 'Active' : 'Inactive'
}

// Admin uses the primary colour and Student the neutral grey, matching the
// role badges in the admin and student headers.
export function roleBadgeClass(role) {
  return role === 'admin' ? 'text-bg-primary' : 'text-bg-secondary'
}
