import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { backendRequestSignal } from "./backend-request";
import { backendUrl, SESSION_COOKIE } from "./server-auth";
export async function readAdmin<T>(path: string): Promise<{status:"ok";data:T} | {status:"anonymous"|"forbidden"|"not_found"|"unavailable"}> {
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return {status:"anonymous"};
  try {
    const response = await fetch(backendUrl(`/api/v1/admin/${path}`), {headers:{Authorization:`Bearer ${token}`},cache:"no-store",signal:backendRequestSignal()});
    if (response.status === 401) return {status:"anonymous"};
    if (response.status === 403) return {status:"forbidden"};
    if (response.status === 404) return {status:"not_found"};
    if (!response.ok) return {status:"unavailable"};
    return {status:"ok",data:await response.json() as T};
  } catch {return {status:"unavailable"};}
}
