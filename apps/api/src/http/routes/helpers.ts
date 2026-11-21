import type { Services } from '../../services/index.js';

/** A signed, short-lived URL for one page of the student's own upload, when we have a thumbnail. */
export async function signedPagePreview(
  services: Services,
  uid: string,
  jobId: string,
  page = 1,
): Promise<string> {
  try {
    const { url } = await services.jobs.thumbUrl(uid, jobId, page);
    return url;
  } catch {
    return '';
  }
}
