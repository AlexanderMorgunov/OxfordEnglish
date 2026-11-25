import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type GameAssetSigner = (
  key: string,
  ttlSeconds: number
) => Promise<string | null>;
let client: S3Client | undefined;
export const signGameAsset: GameAssetSigner = async (key, ttlSeconds) => {
  const bucket = process.env.GAMES_S3_BUCKET;
  if (!bucket) return null;
  client ??= new S3Client({
    region: process.env.S3_REGION ?? 'ru-central1',
    endpoint: process.env.S3_ENDPOINT ?? 'https://storage.yandexcloud.net',
    credentials: {
      accessKeyId: process.env.S3_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET ?? '',
    },
  });
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseCacheControl: 'private, no-store',
    }),
    { expiresIn: ttlSeconds }
  );
};
