import { audioProxy } from "../proxy";
export async function POST(request: Request) { return audioProxy(request, true); }
