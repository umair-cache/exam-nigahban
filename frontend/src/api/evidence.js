import apiClient from './client'
import { notifyPendingReviewsChanged } from '../utils/pendingReviews'

export async function reviewEvidence(evidenceId, action, reason) {
  const { data } = await apiClient.post(`/api/evidence/${evidenceId}/review`, {
    action,
    ...(reason ? { reason } : {}),
  })
  // Only after the server accepted the review: a failed request changes
  // nothing, so the badge is left alone.
  notifyPendingReviewsChanged()
  return data
}

// The evidence image endpoint requires the same JWT bearer auth as every
// other admin API call. A plain <img src="..."> request cannot attach an
// Authorization header, so the image must be fetched through apiClient
// (which does attach it) as a blob, then rendered via an object URL.
export async function fetchEvidenceImageBlob(evidenceId) {
  const { data } = await apiClient.get(`/api/evidence/${evidenceId}/image`, {
    responseType: 'blob',
  })
  return data
}
