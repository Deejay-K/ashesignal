// Paging helpers: the Supabase API returns at most 1000 rows per request, so lists that can grow are read page by page.

/** Read every row of a query, one page of 1000 at a time (the API returns at most 1000 rows per request). */
export async function selectAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
/** The same, for a list of ids, in chunks of 200 so the request stays small. */
export async function selectIn<T>(ids: string[], q: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    out.push(...(await selectAll((a, b) => q(chunk, a, b))));
  }
  return out;
}
