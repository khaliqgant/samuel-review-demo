export function log(msg: string, level: string = 'info'): void {
  console.log(`[oauth] [${level}] ${msg}`);
}
