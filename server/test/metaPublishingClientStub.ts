import { vi } from "vitest";
import type { MetaPublishingProviderClient } from "../src/metaPublishingClient.ts";

// Async protocol methods remain network-free in legacy business-flow tests.
export function asyncPublishingStubs() {
  return {
    createInstagramContainer: vi.fn<MetaPublishingProviderClient["createInstagramContainer"]>(),
    getInstagramContainerStatus: vi.fn<MetaPublishingProviderClient["getInstagramContainerStatus"]>(),
    publishInstagramContainer: vi.fn<MetaPublishingProviderClient["publishInstagramContainer"]>(),
    startFacebookReel: vi.fn<MetaPublishingProviderClient["startFacebookReel"]>(),
    uploadFacebookReel: vi.fn<MetaPublishingProviderClient["uploadFacebookReel"]>(),
    getFacebookReelStatus: vi.fn<MetaPublishingProviderClient["getFacebookReelStatus"]>(),
    finishFacebookReel: vi.fn<MetaPublishingProviderClient["finishFacebookReel"]>(),
  };
}
