/**
 * 危险命令黑名单检查
 * 独立于权限系统，作为命令执行工具的兜底防线
 */
const DANGEROUS_PATTERNS = [
  'rm -rf /',
  'rm -rf ~',
  'sudo',
  'shutdown',
  'reboot',
  '> /dev/',
  'mkfs',
  'dd if=',
  ':(){ :|:\u0026 };:',
  'chmod 777 /',
  'chown -R /',
  'curl',
  'wget',
];

export function isDangerousCommand(command: string): boolean {
  const lowerCmd = command.toLowerCase();
  return DANGEROUS_PATTERNS.some((pattern) => lowerCmd.includes(pattern));
}
