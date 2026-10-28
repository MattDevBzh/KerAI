import * as vscode from 'vscode';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** Owns asset roots and CSP for both cockpit surfaces. */
export async function setWebviewPage(
  target: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  surface: 'cockpit' | 'control',
  options: { theme: string; zoom: string | number; livingHq: boolean },
) {
  target.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.png');
  target.webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
  };
  const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
  const base = target.webview.asWebviewUri(webviewRoot).toString() + '/';
  const nonce = randomBytes(20).toString('hex');
  let html = await readFile(path.join(context.extensionPath, 'dist/webview/index.html'), 'utf8');
  const csp = `default-src 'none'; img-src ${target.webview.cspSource} data:; style-src ${target.webview.cspSource} 'unsafe-inline'; font-src ${target.webview.cspSource}; script-src 'nonce-${nonce}' ${target.webview.cspSource}; connect-src 'none'; base-uri ${target.webview.cspSource}; form-action 'none';`;
  html = html
    .replace(
      /<html\b/,
      `<html data-studio-surface="${surface}" data-studio-theme="${options.theme}" data-studio-zoom="${options.zoom}" data-studio-living-hq="${options.livingHq}"`,
    )
    .replace(
      '<head>',
      `<head><base href="${base}"><meta http-equiv="Content-Security-Policy" content="${csp}">`,
    )
    .replace(/<script\b/g, `<script nonce="${nonce}"`);
  target.webview.html = html;
}
