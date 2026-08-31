import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const repo = join(import.meta.dir, '../..');
const read = (path: string) => Bun.file(join(repo, path)).text();

describe('legal acceptance contract', () => {
  test('requires versioned immutable clickwrap evidence', async () => {
    const sql = await read('supabase/20260831_legal_acceptance.sql');
    const signup = await read('app/src/pages/Login.tsx');
    expect(sql).toContain('legal_acceptances_immutable');
    expect(sql).toContain('accept_current_legal_documents');
    expect(signup).toContain('handleLegalScroll');
    expect(signup).toContain('disabled={!legalScrolled}');
  });
});

describe('Fast engine and Windows 11 camera parity', () => {
  test('does not modify the established Henshin prompts', async () => {
    const promptSource = await read('app/src/lib/personaPrompts.ts');
    expect(createHash('sha256').update(promptSource).digest('hex'))
      .toBe('b23ff1ece313ef5cc7eb999709cacdf94a2dadafdb94b6751d0bf2465764b3d2');
  });

  test('uses the fxswap37 X2 display and single-owner source reconciliation', async () => {
    const stage = await read('app/src/components/studio/Stage.tsx');
    const publisher = await read('app/src/components/studio/useSourcePublisher.ts');
    const persona = await read('app/src/lib/session/applyPersona.ts');
    expect(stage).toContain('X2MainVideoView');
    expect(publisher).toContain('desiredRef.current !== publishedRef.current');
    expect(publisher).toContain("await publish('source', want)");
    expect(persona).toContain('keep_backlog: false');
    expect(persona).toContain('active: false');
  });

  test('ships only the Henshin-branded FrameServer architecture', async () => {
    const ids = await read('native-camera-v2/driver/include/vcam_ids.h');
    const bridge = await read('native-camera-v2/driver/include/henshin_bridge.h');
    const publisher = await read('native-camera-v2/publisher/main.cpp');
    const installer = await read('app/build/installer.nsh');
    expect(ids).toContain('{4F8B2E01-3C7D-4A9F-B6E2-8D1C5A3F9B7E}');
    expect(ids).not.toMatch(/GhostSwap/i);
    expect(bridge).toContain('SLOT_COUNT = 3');
    expect(bridge).toContain('PIXEL_FORMAT_NV12');
    expect(publisher).toContain('BT.709 limited-range RGBA');
    expect(installer).toContain('requires Windows 11');
    expect(installer).not.toContain('AkVirtualCamera');
  });
});
