import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { db } from '../../db/drizzle.js'
import { users } from '../../db/schema/users.js'
import type { LoginInput, RegisterInput } from '@xolo/protocol'

export async function register(input: RegisterInput) {
  const passwordHash = await argon2.hash(input.password)

  const [user] = await db
    .insert(users)
    .values({ name: input.name, email: input.email.toLowerCase(), passwordHash })
    .returning({ id: users.id, name: users.name, email: users.email })
  return user
}
export async function authenticate(input: LoginInput) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, input.email.toLowerCase()))
    .limit(1)
  if (!user || !(await argon2.verify(user.passwordHash, input.password))) return null
  return { id: user.id, name: user.name, email: user.email }
}
