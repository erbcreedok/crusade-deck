const codeToRoomId = new Map<string, string>();

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
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
