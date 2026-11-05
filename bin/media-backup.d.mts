import type { S3Client } from "@aws-sdk/client-s3";

export function backupMedia(client: Pick<S3Client, "send">, bucket: string, destination: string): Promise<{
  objects: number;
  bytes: number;
  persistedChecksumsVerified: true;
  inventoryUnchanged: true;
}>;
