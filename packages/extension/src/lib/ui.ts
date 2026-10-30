import { fmtShort, fmtTime, type ExportResult } from '@training-brief/core';

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(sel)];

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export type StatusKind = '' | 'ok' | 'err' | 'warn';

export function setStatus(el: HTMLElement, text: string, kind: StatusKind = ''): void {
  el.textContent = text;
  el.className = `status${kind ? ' ' + kind : ''}`;
}

/** Copies text, falling back to a hidden textarea when the async clipboard is refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function downloadExport(result: ExportResult): void {
  const blob = new Blob([result.text], { type: `${result.mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** "today 14:02", "yesterday 09:10" or "3 Oct 14:02". */
export function fmtWhen(ms: number): string {
  const d = new Date(ms), now = new Date();
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5);
  return `${days === 0 ? 'today' : days === 1 ? 'yesterday' : fmtShort(d)} ${fmtTime(d)}`;
}

export const fmtTokens = (n: number): string => (n < 1000 ? String(n) : n < 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`);

export const fmtSize = (chars: number): string => (chars < 10240 ? `${(chars / 1024).toFixed(1)} KB` : `${Math.round(chars / 1024)} KB`);
