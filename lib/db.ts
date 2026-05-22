const GATEWAY_URL = process.env.TERMINAL_AI_GATEWAY_URL!

async function dbRequest(method: string, path: string, body: unknown, embedToken: string): Promise<Response> {
  const res = await fetch(`${GATEWAY_URL}/db/${path}`, {
    method,
    headers: { Authorization: `Bearer ${embedToken}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error((err as { error: string }).error ?? `DB error ${res.status}`)
  }
  return res
}

export async function dbList<T = Record<string, unknown>>(
  table: string,
  filters: Record<string, string> = {},
  embedToken: string,
): Promise<T[]> {
  const params = new URLSearchParams(filters)
  const res = await dbRequest('GET', `${table}?${params}`, undefined, embedToken)
  return res.json() as Promise<T[]>
}

export async function dbGet<T = Record<string, unknown>>(table: string, id: string, embedToken: string): Promise<T> {
  const res = await dbRequest('GET', `${table}/${id}`, undefined, embedToken)
  return res.json() as Promise<T>
}

export async function dbInsert<T = Record<string, unknown>>(
  table: string,
  row: Record<string, unknown>,
  embedToken: string,
): Promise<T> {
  const res = await dbRequest('POST', table, row, embedToken)
  return res.json() as Promise<T>
}

export async function dbUpdate<T = Record<string, unknown>>(
  table: string,
  id: string,
  patch: Record<string, unknown>,
  embedToken: string,
): Promise<T> {
  const res = await dbRequest('PATCH', `${table}/${id}`, patch, embedToken)
  return res.json() as Promise<T>
}

export async function dbDelete(table: string, id: string, embedToken: string): Promise<void> {
  await dbRequest('DELETE', `${table}/${id}`, undefined, embedToken)
}
