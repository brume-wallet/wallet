import { SessionData } from "@/mods/background/service_worker/entities/sessions/data"
import { Optional } from "@hazae41/option"
import { createQuerySchema, useQuery } from "@hazae41/xswr"
import { useSubscribe } from "../../storage/storage"
import { UserStorage, useUserStorage } from "../../storage/user"

export function getSession(id: Optional<string>, storage: UserStorage) {
  if (id == null)
    return undefined

  return createQuerySchema<string, SessionData, never>({ key: `session/v3/${id}`, storage })
}

export function useSession(name: Optional<string>) {
  const storage = useUserStorage().unwrap()
  const query = useQuery(getSession, [name, storage])
  useSubscribe(query as any, storage)
  return query
}