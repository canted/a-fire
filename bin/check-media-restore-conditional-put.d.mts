import type { S3Client } from "@aws-sdk/client-s3";
export function checkConditionalPut(client: Pick<S3Client, "send">, bucket: string): Promise<{ conditionalCollisionRejected: boolean; originalPreserved: boolean; syntheticProbeRetained: boolean }>;
