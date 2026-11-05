/** Unit-test lock stand-in; concurrency behavior is covered by the real lock integration suite. */
export function createImmediateBlobLock<Client>(client: Client) {
  return async <Result>(_blobId: number, operation: (transaction: Client) => Result | Promise<Result>) => operation(client);
}
