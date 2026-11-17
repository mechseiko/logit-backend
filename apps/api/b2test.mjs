import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
const c = new S3Client({
  region: 'us-east-005',
  endpoint: 'https://s3.us-east-005.backblazeb2.com',
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});
const url = await getSignedUrl(c, new PutObjectCommand({ Bucket: 'uselogit', Key: 'cors-test/hello.txt', ContentType: 'text/plain' }), { expiresIn: 300 });
console.log(url);
