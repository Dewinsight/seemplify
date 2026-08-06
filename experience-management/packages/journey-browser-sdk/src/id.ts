export function createUuid(random: () => number) {
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    const value = random();
    bytes[index] = Math.floor(Math.max(0, Math.min(0.9999999999999999, value)) * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
