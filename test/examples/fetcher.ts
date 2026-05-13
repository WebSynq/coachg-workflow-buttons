export type User = {
  id: number
  name: string
}

export async function fetchUser(id: number): Promise<User> {
  const res = await fetch(`https://api.example.com/users/${id}`)
  if (res.status === 404) {
    throw new Error(`user ${id} not found`)
  }
  if (!res.ok) {
    throw new Error(`fetchUser failed: ${res.status}`)
  }
  return res.json() as Promise<User>
}
