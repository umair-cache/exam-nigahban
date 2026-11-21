import apiClient from './client'

export async function listExams() {
  const { data } = await apiClient.get('/api/exams')
  return data
}

export async function getExam(examId) {
  const { data } = await apiClient.get(`/api/exams/${examId}`)
  return data
}

export async function createExam({
  title,
  description,
  durationMinutes,
  contentType = 'native',
  requireScreenShare = false,
}) {
  const { data } = await apiClient.post('/api/exams', {
    title,
    description: description || undefined,
    duration_minutes: durationMinutes,
    content_type: contentType,
    require_screen_share: requireScreenShare,
  })
  return data
}

export async function updateExam(
  examId,
  { title, description, durationMinutes, contentType = 'native', requireScreenShare = false },
) {
  const { data } = await apiClient.put(`/api/exams/${examId}`, {
    title,
    description: description || undefined,
    duration_minutes: durationMinutes,
    content_type: contentType,
    require_screen_share: requireScreenShare,
  })
  return data
}

export async function updateExamStatus(examId, examStatus) {
  const { data } = await apiClient.patch(`/api/exams/${examId}/status`, {
    status: examStatus,
  })
  return data
}

export async function deleteExam(examId) {
  await apiClient.delete(`/api/exams/${examId}`)
}

export async function uploadIspringPackage(examId, file) {
  const form = new FormData()
  form.append('package_file', file)
  const { data } = await apiClient.post(`/api/exams/${examId}/ispring-package`, form)
  return data
}
