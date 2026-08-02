export interface ServerSentEventFrame {
  id?: string;
  event: string;
  data: string;
}

export function parseServerSentEventBuffer(buffer: string): {
  frames: ServerSentEventFrame[];
  remainder: string;
} {
  const chunks = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n\n');
  const remainder = chunks.pop() || '';
  const frames = chunks.flatMap((chunk) => {
    let event = 'message';
    let id: string | undefined;
    const data: string[] = [];
    for (const line of chunk.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('id:')) id = line.slice(3).trim();
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    return data.length ? [{ ...(id ? { id } : {}), event, data: data.join('\n') }] : [];
  });
  return { frames, remainder };
}
