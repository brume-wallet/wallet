import { Status, StatusData } from "@/mods/background/service_worker/entities/sessions/status/data";
import { UserStorage, useUserStorageContext } from "@/mods/foreground/user/mods/storage";
import { createQuery, useQuery } from "@hazae41/glacier";
import { Nullable } from "@hazae41/option";

export function getStatus(id: Nullable<string>, storage: UserStorage) {
  if (id == null)
    return undefined

  return createQuery<string, StatusData, never>({ key: Status.key(id), storage })
}

export function useStatus(id: Nullable<string>) {
  const storage = useUserStorageContext().getOrThrow()
  const query = useQuery(getStatus, [id, storage])

  return query
}