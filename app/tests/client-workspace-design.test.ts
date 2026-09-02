import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const repo = join(import.meta.dir, '../..');
const read = (path: string) => Bun.file(join(repo, path)).text();

describe('client workspace architecture', () => {
  test('keeps the Studio mounted while client tools open as nonmodal panels', async () => {
    const app = await read('app/src/App.tsx');
    const workspace = await read('app/src/components/ClientWorkspace.tsx');

    expect(app).toContain('<Route element={<ClientWorkspace />}>');
    expect(workspace).toContain('<Dashboard />');
    expect(workspace).toContain('aria-modal="false"');
    expect(workspace).toContain("event.key === 'Escape'");
    expect(workspace).not.toContain('<AppDialog');
  });

  test('uses the saturated reference gradient only on the public presentation scene', async () => {
    const publicScene = await read('app/src/components/app/PublicScene.tsx');
    const dashboard = await read('app/src/pages/Dashboard.tsx');
    const styles = await read('app/src/index.css');

    expect(publicScene).toContain('reference-atmosphere');
    expect(dashboard).toContain('studio-canvas');
    expect(dashboard).not.toContain('reference-atmosphere');
    expect(styles).toContain('.workspace-panel::before');
    expect(styles).toContain('rgb(255 255 255 / 0.06)');
  });

  test('keeps transport logic available in the client session dock', async () => {
    const bar = await read('app/src/components/studio/SessionBar.tsx');
    const dashboard = await read('app/src/pages/Dashboard.tsx');

    expect(bar).toContain('onOpenCameraPicker');
    expect(bar).toContain("t('studio.rateLine'");
    expect(bar).toContain('remainingCreditsLabel');
    expect(bar).toContain('onStart');
    expect(bar).toContain('onStop');
    expect(bar).toContain('studio-transport');
    expect(dashboard).toContain('client-session-dock');
  });

  test('renders the compact reference-style transport without a disabled-reason row', async () => {
    const bar = await read('app/src/components/studio/SessionBar.tsx');
    const styles = await read('app/src/index.css');

    expect(bar).toContain('session-control-rail');
    expect(bar).toContain('session-command-bay');
    expect(bar).toContain('session-command-bay flex min-w-0 items-center gap-2');
    expect(bar).toContain('session-panel-button');
    expect(bar).toContain('<Power />');
    expect(bar).toContain('session-mode-switch');
    expect(bar).toContain('session-live-metrics');
    expect(bar).toContain('formatSessionDuration');
    expect(bar).toContain('session-quick-actions');
    expect(bar).toContain('PhosphorCamera');
    expect(bar).toContain("apiFetch('/support'");
    expect(bar).toContain("action: 'send-message'");
    expect(bar).toContain('supportMessages.map');
    expect(bar).not.toContain('https://wa.me/237620124019');
    expect(bar).not.toContain('ROUTES.PROTECTED.HISTORY');
    expect(styles).not.toContain('.session-tools-menu');
    expect(styles).not.toContain('.session-tools-item');
    expect(bar).not.toContain('border-t border-white/[0.05] px-4 py-1.5');
    expect(styles).toContain('background: transparent;');
    expect(styles).toContain('#11112d');
    expect(styles).toContain('.session-panel-button');
    expect(styles).toMatch(/\.session-support-anchor \{[\s\S]*?align-self: flex-end;[\s\S]*?margin-left: auto;/);
    expect(styles).toMatch(/\.session-panel-button \{[\s\S]*?box-shadow: none;/);
    expect(styles).toContain('.session-quick-button');
    expect(styles).toContain('border-radius: 9px');
    expect(styles).toContain('justify-content: flex-end');
    expect(styles).toContain('.session-command-bay');
    expect(styles).toContain('.session-command-bay::before');
    expect(styles).toContain('min-height: 72px');
    expect(styles).toContain('/* A3 and the lower command bay read as one stepped silhouette. */');
    expect(styles).toContain('flex: 0 1 auto');
    expect(styles).toContain('border-top: 0');
    expect(styles).toContain('align-items: center');
    expect(styles).toContain('justify-content: flex-start');
    expect(styles).toContain('padding: 0 30px 0 10px');
    expect(styles).toContain('circle at 100% 100%');
    expect(styles).toContain('#34344e');
    expect(styles).toContain('#292943');
  });

  test('opens the WhatsApp support control as a responsive assistant card', async () => {
    const bar = await read('app/src/components/studio/SessionBar.tsx');
    const styles = await read('app/src/index.css');

    expect(bar).toContain('session-support-widget');
    expect(bar).toContain('role="dialog"');
    expect(bar).toContain('session-support-conversation');
    expect(bar).toContain('session-support-topics');
    expect(bar).toContain('session-support-composer');
    expect(bar).toContain('supportExpanded');
    expect(styles).toContain('width: min(400px, calc(100vw - 32px))');
    expect(styles).toContain('height: min(680px, calc(100dvh - 125px))');
    expect(styles).toContain('z-index: 9999');
    expect(styles).toMatch(/\.session-support-widget \{[\s\S]*?right: 0;[\s\S]*?left: auto;/);
    expect(styles).toContain('bottom: 0');
    expect(styles).toContain('.session-support-widget.is-expanded');
  });

  test('keeps the measured sidebar typography with an icon-only collapsed state', async () => {
    const sidebar = await read('app/src/components/ClientSidebar.tsx');
    const layout = await read('app/src/components/Layout.tsx');
    const styles = await read('app/src/index.css');
    const entry = await read('app/src/main.tsx');

    expect(sidebar).toContain('client-sidebar-primary');
    expect(styles).toContain('width: 266px');
    expect(styles).toContain('padding-inline: 15px');
    expect(styles).toContain(".client-sidebar[data-collapsed='true']");
    expect(styles).toContain('border-right: 0');
    expect(sidebar).toContain('client-sidebar-collapse');
    expect(sidebar).toContain("!collapsed ? <span");
    expect(layout).not.toContain('client-topbar-sidebar-toggle');
    expect(styles).toContain('font-size: 16px');
    expect(styles).toContain('text-underline-offset: 1.6px');
    expect(styles).toContain('.client-sidebar-heading-row');
    expect(styles).toContain('.client-sidebar-divider');
    expect(sidebar).not.toContain('<span className="client-sidebar-divider" aria-hidden />');
    expect(styles).not.toContain('.client-sidebar-primary > .client-sidebar-divider');
    expect(styles).toContain('gap: 8px');
    expect(styles).toContain('margin-top: 0');
    expect(styles).toContain("content: '\\21E2'");
    expect(entry).toContain("@fontsource-variable/manrope");
  });

  test('adds the requested five-percent contrast frame around Studio', async () => {
    const styles = await read('app/src/index.css');

    expect(styles).toContain('.client-studio-workspace');
    expect(styles).toContain('background: rgb(0 0 0 / 0.05)');
    expect(styles).toContain('border: 1px solid rgb(0 0 0 / 0.07)');
  });

  test('places notifications in a wider top-center dynamic island', async () => {
    const toaster = await read('app/src/components/ui/sonner.tsx');
    const styles = await read('app/src/index.css');

    expect(toaster).toContain('position="top-center"');
    expect(toaster).toContain('dynamic-island-toaster');
    expect(styles).toContain("--width: min(420px, calc(100vw - 56px))");
    expect(styles).toContain('.dynamic-island-toaster [data-sonner-toast]');
    expect(styles).toContain('border-radius: 0 0 21px 21px !important');
    expect(styles).toContain("radial-gradient(circle at 0 100%, transparent 19.5px");
    expect(styles).toContain("[data-type='info'] [data-icon]");
    expect(styles).toContain("[data-type='warning'] [data-icon]");
    expect(styles).toContain("[data-type='error'] [data-icon]");
    expect(styles).toContain("[data-type='success'] [data-icon]");
  });

  test('moves the stable source preview from Stage to the Persona inspector', async () => {
    const dashboard = await read('app/src/pages/Dashboard.tsx');
    const stage = await read('app/src/components/studio/Stage.tsx');

    expect(dashboard).toContain('client-source-preview');
    expect(dashboard).toContain('className="client-source-preview shrink-0"');
    expect(dashboard).not.toContain('client-source-preview shrink-0 px-4 pb-4');
    expect(dashboard).toContain('ref={webcamVideoRef}');
    expect(stage).not.toContain('studio-camera-pip');
    expect((await read('app/src/index.css'))).not.toContain('.studio-camera-pip');
  });

  test('keeps the support widget above Persona and uses the sidebar font there', async () => {
    const styles = await read('app/src/index.css');

    expect(styles).toContain('.client-studio-workspace .client-studio-primary');
    expect(styles).toContain('overflow: visible');
    expect(styles).toMatch(/\.client-studio-primary \{[\s\S]*?z-index: 3;/);
    expect(styles).toMatch(/\.client-persona-inspector \{[\s\S]*?z-index: 1;/);
    expect(styles).toMatch(/\.client-persona-panel \{[\s\S]*?font-family: 'Manrope Variable'/);
    expect(styles).toMatch(/\.session-support-widget \{[\s\S]*?z-index: 9999;/);
  });

  test('uses X2 consistently as the visible Fast-engine label', async () => {
    const bar = await read('app/src/components/studio/SessionBar.tsx');
    const plan = await read('app/src/components/ClientPlanMenu.tsx');
    const fr = await read('app/src/i18n/resources/fr.ts');
    const en = await read('app/src/i18n/resources/en.ts');
    const providers = await read('app/src/lib/liveProvider.ts');

    expect(bar).toContain('>\n            X2\n          </button>');
    expect(plan).toContain("isPro ? 'PRO' : 'X2'");
    expect(fr).toContain("fast: 'X2'");
    expect(en).toContain("fast: 'X2'");
    expect(providers).toContain("{ value: 'fast', label: 'X2', hint: 'Reactor' }");
  });
});
