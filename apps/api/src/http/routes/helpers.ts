import type { Services } from '../../services/index.js';

/** Signed page-1 image for a template, or '' when the template has no stored page image. */
export async function signedTemplatePreview(services: Services, templateId: string): Promise<string> {
  try {
    const { url } = await services.templates.pageUrl(templateId, 1);
    return url;
  } catch {
    return '';
  }
}
