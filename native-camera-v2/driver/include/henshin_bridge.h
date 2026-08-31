#ifndef HENSHIN_BRIDGE_PROTOCOL_H
#define HENSHIN_BRIDGE_PROTOCOL_H

#pragma once

#include <stdint.h>
#include <stddef.h>

constexpr static const uint32_t MAGIC = 1213092680; // 0x484E5348, "HNSH"
constexpr static const uint16_t PROTOCOL_MAJOR = 1;
constexpr static const uint16_t PROTOCOL_MINOR = 0;
constexpr static const uint32_t HEADER_SIZE = 256;
constexpr static const uint32_t SLOT_HEADER_SIZE = 64;
constexpr static const uint32_t SLOT_COUNT = 3;
constexpr static const uint32_t PIXEL_FORMAT_NV12 = 1;
constexpr static const uint32_t COLOR_MATRIX_BT709 = 1;
constexpr static const uint32_t COLOR_RANGE_LIMITED = 1;
constexpr static const uint32_t SLOT_FLAG_REPEATED = 1;
constexpr static const uint32_t MAX_READ_ATTEMPTS = 3;

struct alignas(64) BridgeHeader {
  uint32_t magic;
  uint16_t protocol_major;
  uint16_t protocol_minor;
  uint32_t header_size;
  uint32_t slot_count;
  uint64_t total_mapping_size;
  uint64_t slot_stride_bytes;
  uint32_t capacity_width;
  uint32_t capacity_height;
  uint64_t generation;
  uint32_t producer_pid;
  uint32_t pixel_format;
  uint32_t width;
  uint32_t height;
  uint32_t fps_num;
  uint32_t fps_den;
  uint32_t stride_y;
  uint32_t stride_uv;
  uint32_t offset_y_within_slot;
  uint32_t offset_uv_within_slot;
  uint32_t frame_payload_size;
  uint32_t color_matrix;
  uint32_t color_range;
  uint32_t _pad0;
  uint64_t published_frame_id;
  uint64_t heartbeat_qpc;
  uint64_t qpc_frequency;
  uint64_t flags;
  uint64_t reserved[15];
};

struct alignas(64) SlotHeader {
  uint64_t sequence;
  uint64_t frame_id;
  uint64_t capture_qpc;
  uint64_t publish_qpc;
  uint32_t payload_size;
  uint32_t flags;
  uint64_t reserved[3];
};

static_assert(sizeof(BridgeHeader) == 256, "BridgeHeader must be 256 bytes");
static_assert(alignof(BridgeHeader) == 64, "BridgeHeader must be align 64");
static_assert(sizeof(SlotHeader) == 64, "SlotHeader must be 64 bytes");
static_assert(alignof(SlotHeader) == 64, "SlotHeader must be align 64");

#endif
