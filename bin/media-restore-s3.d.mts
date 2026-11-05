import type { S3Client } from "@aws-sdk/client-s3";
export function restoreMediaToS3(client: Pick<S3Client, "send">, source: string, bucket: string): Promise<{
  objects: number; bytes: number; allRestoredHashesMatch: true; objectMetadataVerified: true; inventoryVerified: true;
}>;
