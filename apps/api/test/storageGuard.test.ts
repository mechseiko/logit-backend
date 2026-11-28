import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestContext } from './helpers.js';

/**
 * A failed bucket listing used to abort the upload with a bare 500 ("Something went wrong on our
 * side") before the student could even get a presigned URL. Storage accounting is advisory, so the
 * upload must survive it.
 */
describe('upload survives a storage accounting failure', () => {
  it('still presigns when usedBytes throws', async () => {
    const ctx = await createTestContext();
    const auth = `Bearer ${ctx.token('accounting@uselogit.cv')}`;
    await request(ctx.app).get('/api/me').set('authorization', auth);
    await request(ctx.app)
      .patch('/api/me/onboarding')
      .set('authorization', auth)
      .send({
        schoolId: 'oau',
        department: 'Mechanical Engineering',
        programme: 'SIWES',
        level: '300',
        consent: { version: '2026-02-01', over18: true },
      });

    ctx.storage.usedBytes = async () => {
      throw new Error('listing failed');
    };

    const response = await request(ctx.app)
      .post('/api/uploads/presign')
      .set('authorization', auth)
      .send({ kind: 'pdf', files: [{ name: 'book.pdf', size: 1024, type: 'application/pdf' }] });

    expect(response.status).toBe(200);
    expect(response.body.uploads).toHaveLength(1);
  });
});
