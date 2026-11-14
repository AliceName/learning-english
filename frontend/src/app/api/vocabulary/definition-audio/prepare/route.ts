import { definitionAudioProxy } from "../proxy";
export async function POST(request: Request) { return definitionAudioProxy(request, true); }
