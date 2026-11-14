import { definitionAudioProxy } from "./proxy";
export async function GET(request: Request) { return definitionAudioProxy(request, false); }
