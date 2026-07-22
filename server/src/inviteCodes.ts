const codeToRoomId = new Map<string, string>();

function generateCode(): string {
  // 4 цифры, с ведущими нулями (0000–9999).
  return Math.floor(Math.random() * 10000).toString().padStart(4, "0");
}

export function registerInviteCode(roomId: string): string {
  let code = generateCode();
  while (codeToRoomId.has(code)) code = generateCode();
  codeToRoomId.set(code, roomId);
  return code;
}

export function resolveInviteCode(code: string): string | undefined {
  return codeToRoomId.get(code);
}

export function releaseInviteCode(code: string) {
  codeToRoomId.delete(code);
}
