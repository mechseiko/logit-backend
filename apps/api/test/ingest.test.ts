import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { LIMITS } from '@logit/shared';
import {
  createTestContext,
  onboard,
  processQueue,
  signIn,
  uploadJob,
  waitForJob,
  type SignedIn,
  type TestContext,
} from './helpers.js';
import { makeLogbookPdf, makeLongPdf, makePhotoJpeg } from './fixtures.js';

let ctx: TestContext;

afterEach(async () => {
  await ctx?.close();
});

async function setup(): Promise<SignedIn> {
  ctx = await createTestContext();
  const session = await signIn(ctx, 'ingest@test.local');
  await onboard(ctx, session);
  return session;
}

describe('ingest pipeline', () => {
  it('rejects a corrupt PDF without touching credits', async () => {
    const session = await setup();
    const jobId = await uploadJob(ctx, session.auth, 'pdf', [
      {
        name: 'corrupt.pdf',
        type: 'application/pdf',
        bytes: Buffer.from('%PDF-1.4\nthis is not a valid document body'),
      },
    ]);
    await processQueue(ctx);
    const job = await waitForJob(ctx, jobId, (entry) => entry.status === 'failed');
    expect(job.error?.code).toBe('UNSUPPORTED_FILE');
    expect(job.error?.retryable).toBe(false);
    const credits = await request(ctx.app).get('/api/credits').set(session.auth);
    expect(credits.body.balance).toBe(0);
  });

  it('rejects a PDF with too many pages', async () => {
    const session = await setup();
    const pdf = await makeLongPdf(51);
    const jobId = await uploadJob(ctx, session.auth, 'pdf', [
      { name: 'long.pdf', type: 'application/pdf', bytes: pdf },
    ]);
    await processQueue(ctx);
    const job = await waitForJob(ctx, jobId, (entry) => entry.status === 'failed');
    expect(job.error?.code).toBe('TOO_MANY_PAGES');
    expect(job.error?.message).toContain('51');
  });

  it('compiles photos into one PDF in order and bakes EXIF rotation', async () => {
    const session = await setup();
    const rotated = await makePhotoJpeg(6);
    const normal = await makePhotoJpeg(1);
    const jobId = await uploadJob(ctx, session.auth, 'images', [
      { name: 'page-1.jpg', type: 'image/jpeg', bytes: rotated },
      { name: 'page-2.jpg', type: 'image/jpeg', bytes: normal },
    ]);
    await processQueue(ctx);
    const job = await waitForJob(ctx, jobId, (entry) => entry.status === 'needs_intake');
    expect(job.profileId).toBeTruthy();
    expect(job.normalized?.pages).toBe(2);
    expect(job.analysis?.hasEmbeddedText).toBe(false);
    expect(job.analysis?.thumbnailKind).toBe('placeholder');
    expect(await ctx.storage.exists(`thumbs/${session.uid}/${jobId}/p1.png`)).toBe(true);
    expect(await ctx.storage.exists(`normalized/${session.uid}/${jobId}/original.pdf`)).toBe(true);
    // Raw uploads are removed once the normalized copy exists.
    expect(await ctx.storage.exists(job.input.files[0]!.key)).toBe(false);
  });

  it('rejects an oversized PDF at presign time', async () => {
    const session = await setup();
    const response = await request(ctx.app)
      .post('/api/uploads/presign')
      .set(session.auth)
      .send({
        kind: 'pdf',
        files: [{ name: 'huge.pdf', type: 'application/pdf', size: LIMITS.maxPdfBytes + 1024 }],
      });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/20 MB/);
  });

  it('enforces the per-user active job limit', async () => {
    const session = await setup();
    for (let index = 0; index < 3; index += 1) {
      const pdf = await makeLogbookPdf({ pages: 1, withText: false });
      const id = await uploadJob(ctx, session.auth, 'pdf', [
        { name: `book-${index}.pdf`, type: 'application/pdf', bytes: pdf },
      ]);
      await processQueue(ctx);
      await waitForJob(ctx, id, (entry) => entry.status !== 'queued' && entry.status !== 'processing');
    }
    const pdf = await makeLogbookPdf({ pages: 1, withText: false });
    const response = await request(ctx.app)
      .post('/api/uploads/presign')
      .set(session.auth)
      .send({
        kind: 'pdf',
        files: [{ name: 'fourth.pdf', type: 'application/pdf', size: pdf.byteLength }],
      });
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('LIMIT_REACHED');
  });
});
