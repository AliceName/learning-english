import { cookies } from "next/headers";
import { backendUrl, SESSION_COOKIE } from "@/lib/server-auth";
import { backendRequestSignal } from "@/lib/backend-request";
export async function GET(request: Request, context: {params:Promise<{fileName:string}>}) {
  const {fileName} = await context.params;
  if (!/^[a-f0-9]{32}\.(jpg|jpeg|png|webp|mp3|wav|aac|m4a)$/.test(fileName)) return new Response(null,{status:404});
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return new Response(null,{status:401});
  try {
    const range = request.headers.get("range");
    const response = await fetch(backendUrl(`/api/v1/media/${fileName}`), {headers:{Authorization:`Bearer ${token}`,...(range?{Range:range}:{})},cache:"no-store",signal:backendRequestSignal(request.signal)});
    const headers = new Headers({"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"});
    for (const key of ["content-type","content-length","accept-ranges","content-range","last-modified"]) { const value = response.headers.get(key); if (value) headers.set(key,value); }
    return new Response(response.body,{status:response.status,headers});
  } catch {return new Response(null,{status:request.signal.aborted?499:503});}
}
