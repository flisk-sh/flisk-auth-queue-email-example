// Flisk's DATABASE_URL carries Prisma's `?schema=` parameter. Postgres rejects it as a
// startup parameter, and Bun's SQL client forwards query parameters, so it is dropped here.
export function cleanDatabaseUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.delete('schema');
  return u.toString();
}
