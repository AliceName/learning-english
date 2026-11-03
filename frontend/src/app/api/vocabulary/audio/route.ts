import { audioProxy } from "./proxy";
export async function GET(request: Request) { return audioProxy(request, false); }
