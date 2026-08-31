// Stable identity of the Henshin virtual camera (CLSID + friendly name).
// Shared by henshin-vcam.dll and the Electron pipe publisher.

#pragma once

#include <guiddef.h>

// {4F8B2E01-3C7D-4A9F-B6E2-8D1C5A3F9B7E}
DEFINE_GUID(CLSID_HenshinVirtualCamera,
            0x4f8b2e01, 0x3c7d, 0x4a9f,
            0xb6, 0xe2, 0x8d, 0x1c,
            0x5a, 0x3f, 0x9b, 0x7e);

#define HENSHIN_VCAM_CLSID_STRING L"{4F8B2E01-3C7D-4A9F-B6E2-8D1C5A3F9B7E}"
#define HENSHIN_VCAM_FRIENDLY_NAME L"Henshin Camera"
#define HENSHIN_VCAM_MODULE_NAME L"henshin-vcam.dll"

#define HENSHIN_VCAM_WIDTH 1280u
#define HENSHIN_VCAM_HEIGHT 720u
#define HENSHIN_VCAM_FPS_NUM 30u
#define HENSHIN_VCAM_FPS_DEN 1u
